//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

const emailRender = require('../lib/emailRender');
const express = require('express');
const isEmail = require('validator/lib/isEmail');
const router = express.Router();
const utils = require('../utils');
const unlinkRoute = require('./unlink');

router.use((req, res, next) => {
  const providers = req.app.settings.providers;
  const operations = providers.operations;
  const insights = providers.insights;
  const config = operations.config;
  let validateAndBlockGuests = false;
  if (config && config.activeDirectory && config.activeDirectory.blockGuestUserTypes) {
    validateAndBlockGuests = true;
  }
  // If the app has not been configured to check whether a user is a guest before linking, continue:
  if (!validateAndBlockGuests) {
    return next();
  }
  const aadId = req.legacyUserContext.id.aad;
  // If the app is configured to check guest status, do this now, before linking:
  const graphProvider = providers.graphProvider;
  // REFACTOR: delegate the decision to the auth provider
  if (!graphProvider || !graphProvider.getUserById) {
    return next(new Error('User type validation cannot be performed because there is no graphProvider configured for this type of account'));
  }
  insights.trackEvent({
    name: 'LinkValidateNotGuestStart',
    properties: {
      aadId: aadId,
    },
  });
  graphProvider.getUserById(aadId, (graphError, details) => {
    if (graphError) {
      insights.trackException({
        exception: graphError,
        properties: {
          aadId: aadId,
          name: 'LinkValidateNotGuestGraphFailure',
        },
      });
      return next(graphError);
    }
    const userType = details.userType;
    const displayName = details.displayName;
    const userPrincipalName = details.userPrincipalName;
    let block = userType === 'Guest';
    let blockedRecord = block ? 'BLOCKED' : 'not blocked';
    // If the app is configured to check for guests, but this is a specifically permitted guest user, continue:
    if (config && config.activeDirectoryGuests && config.activeDirectoryGuests.authorizedIds && config.activeDirectoryGuests.authorizedIds.length && config.activeDirectoryGuests.authorizedIds.includes(aadId)) {
      block = false;
      blockedRecord = 'specifically authorized user ' + aadId + ' ' + userPrincipalName;
      /// HACK !
      req.overrideLinkUserPrincipalName = userPrincipalName;
      req.legacyUserContext.usernames.azure = userPrincipalName;
    }
    insights.trackEvent({
      name: 'LinkValidateNotGuestGraphSuccess',
      properties: {
        aadId: aadId,
        userType: userType,
        displayName: displayName,
        userPrincipalName: userPrincipalName,
        blocked: blockedRecord,
      },
    });
    if (block) {
      insights.trackMetric({ name: 'LinksBlockedForGuests', value: 1 });
      return next(new Error(`This system is not available to guests. You are currently signed in as ${displayName} ${userPrincipalName}. Please sign out or try a private browser window.`));
    }
    return next();
  });
});

router.get('/', function (req, res, next) {
  const link = req.legacyUserContext.entities.link;
  if (!(req.legacyUserContext.usernames.azure && req.legacyUserContext.usernames.github)) {
    req.insights.trackEvent({ name: 'PortalSessionNeedsBothGitHubAndAadUsernames' });
    return res.redirect('/?signin');
  }
  if (!link) {
    showLinkPage(req, res, next);
  } else {
    req.insights.trackEvent({ name: 'LinkRouteLinkLocated' });
    return req.legacyUserContext.render(req, res, 'linkConfirmed', 'You\'re already linked');
  }
});

function showLinkPage(req, res) {
  function render(options) {
    req.legacyUserContext.render(req, res, 'link', 'Link GitHub with corporate identity', options || {});
  }
  const config = req.app.settings.runtimeConfig;
  const graphProvider = req.app.settings.graphProvider;
  if (config.authentication.scheme !== 'aad' || !graphProvider){
    return render();
  }
  const aadId = req.legacyUserContext.id.aad;
  graphProvider.getUserAndManagerById(aadId, (error, graphUser) => {
    // By design, we want to log the errors but do not want any individual
    // lookup problem to break the underlying experience of letting a user
    // link. This is important if someone is new in the company, they may
    // not be in the graph fully yet.
    if (error) {
      req.insights.trackException({
        exception: error,
        properties: {
          event: 'PortalLinkInformationGraphLookupError',
        },
      });
    } else if (graphUser) {
      req.insights.trackEvent({ name: graphUser.manager ? 'PortalLinkInformationGraphLookupUser' : 'PortalLinkInformationGraphLookupServiceAccount' });
    }
    render({
      graphUser: graphUser,
      isServiceAccountCandidate: graphUser && !graphUser.manager,
    });
  });
}

router.get('/enableMultipleAccounts', function (req, res) {
  if (req.user.github) {
    req.session.enableMultipleAccounts = true;
    return res.redirect('/link/cleanup');
  }
  req.insights.trackEvent({ name: 'PortalUserEnabledMultipleAccounts' });
  utils.storeOriginalUrlAsReferrer(req, res, '/auth/github', 'multiple accounts enabled need to auth with GitHub again now');
});

router.post('/', linkUser);

function sendWelcomeMailThenRedirect(req, res, config, url, linkObject, mailProvider, linkedAccountMail) {
  res.redirect(url);

  if (!mailProvider || !linkedAccountMail) {
    return;
  }

  const to = [
    linkedAccountMail,
  ];
  const toAsString = to.join(', ');

  const cc = [];
  if (config.brand && config.brand.operationsEmail && linkObject.isServiceAccount) {
    cc.push(config.brand.operationsEmail);
  }

  const mail = {
    to: to,
    subject: `${linkObject.aadupn} linked to ${linkObject.ghu}`,
    correlationId: req.correlationId,
    category: ['link', 'repos'],
  };
  const contentOptions = {
    reason: (`You are receiving this one-time e-mail because you have linked your account.
              To stop receiving these mails, you can unlink your account.
              This mail was sent to: ${toAsString}`),
    headline: `Welcome to GitHub, ${linkObject.ghu}`,
    notification: 'information',
    app: `${config.brand.companyName} GitHub`,
    correlationId: req.correlationId,
    link: linkObject,
  };
  emailRender.render(req.app.settings.basedir, 'link', contentOptions, (renderError, mailContent) => {
    if (renderError) {
      return req.insights.trackException({
        exception: renderError,
        properties: {
          content: contentOptions,
          eventName: 'LinkMailRenderFailure',
        },
      });
    }
    mail.content = mailContent;
    mailProvider.sendMail(mail, (mailError, mailResult) => {
      const customData = {
        content: contentOptions,
        receipt: mailResult,
      };
      if (mailError) {
        customData.eventName = 'LinkMailFailure';
        return req.insights.trackException({ exception: mailError, properties: customData });
      }
      return req.insights.trackEvent({ name: 'LinkMailSuccess', properties: customData });
    });
  });
}

function linkUser(req, res, next) {
  const config = req.app.settings.runtimeConfig;
  const isServiceAccount = req.body.sa === '1';
  const serviceAccountMail = req.body.serviceAccountMail;
  const linkedAccountMail = req.body.sam;
  const operations = req.app.settings.providers.operations;
  const mailProvider = req.app.settings.mailProvider;
  if (isServiceAccount && !isEmail(serviceAccountMail)) {
    return next(utils.wrapError(null, 'Please enter a valid e-mail address for the Service Account maintainer.', true));
  }
  req.insights.trackEvent({ name: isServiceAccount ? 'PortalUserLinkingServiceAccountStart' : 'PortalUserLinkingStart' });
  const metricName = isServiceAccount ? 'PortalServiceAccountLinks' : 'PortalUserLinks';
  const dc = req.app.settings.dataclient;
  dc.createLinkObjectFromRequest(req, function (createLinkError, linkObject) {
    if (createLinkError) {
      return next(utils.wrapError(createLinkError, `We had trouble linking your corporate and GitHub accounts: ${createLinkError.message}`));
    }
    if (isServiceAccount) {
      linkObject.serviceAccount = true;
      linkObject.serviceAccountMail = serviceAccountMail;
    }
    dc.insertLink(req.user.github.id, linkObject, function (insertError) {
      const aadIdentity = {
        preferredName: linkObject.aadname,
        userPrincipalName: linkObject.aadupn,
        id: linkObject.aadoid,
      };
      const eventData = {
        github: {
          id: linkObject.ghid,
          login: linkObject.ghu,
        },
        aad: aadIdentity,
      };
      req.insights.trackEvent({ name: 'PortalUserLink' });
      req.insights.trackMetric({ name: metricName, value: 1 });
      if (insertError) {
        req.insights.trackException({
          exception: insertError,
          properties: {
            event: 'PortalUserLinkInsertLinkError',
          },
        });
        // There are legacy upgrade scenarios for some users where they already have a
        // link, even though they are already on this page. In that case, we just do
        // a retroactive upsert.
        dc.updateLink(req.user.github.id, linkObject, function (updateLinkError) {
          if (updateLinkError) {
            req.insights.trackException({
              exception: updateLinkError,
              properties: {
                event: 'PortalUserLinkInsertLinkSecondError',
              },
            });
            updateLinkError.original = insertError;
            return next(utils.wrapError(updateLinkError, 'We had trouble storing the corporate identity link information after 2 tries. Please file this issue and we will have an administrator take a look.'));
          }
          req.legacyUserContext.invalidateLinkCache(() => {
            operations.fireLinkEvent(eventData);
            sendWelcomeMailThenRedirect(req, res, config, '/?onboarding=yes', linkObject, mailProvider, linkedAccountMail);
          });
        });
      } else {
        operations.fireLinkEvent(eventData);
        sendWelcomeMailThenRedirect(req, res, config, '/?onboarding=yes', linkObject, mailProvider, linkedAccountMail);
      }
    });
  });
}

router.use('/remove', unlinkRoute);

router.get('/reconnect', function (req, res, next) {
  const config = req.app.settings.runtimeConfig;
  const legacyUserContext = req.legacyUserContext;
  if (config.authentication.scheme !== 'aad'){
    return next(utils.wrapError(null, 'Account reconnection is only needed for Active Directory authentication applications.', true));
  }
  // If the request comes back to the reconnect page, the authenticated app will
  // actually update the link the next time around.
  if (req.user.github && req.user.github.id || !(legacyUserContext && legacyUserContext.entities && legacyUserContext.entities.link && legacyUserContext.entities.link.ghu && !legacyUserContext.entities.link.ghtoken)) {
    req.insights.trackEvent({ name: 'PortalUserReconnected' });
    return res.redirect('/');
  }
  req.insights.trackEvent({ name: 'PortalUserReconnectNeeded' });
  return req.legacyUserContext.render(req, res, 'reconnectGitHub', 'Please sign in with GitHub', {
    expectedUsername: legacyUserContext.entities.link.ghu,
    migratedOpenSourceHubUser: legacyUserContext.entities.link.hubImport,
  });
});

router.get('/update', function (req, res, next) {
  const config = req.app.settings.runtimeConfig;
  const username = req.legacyUserContext.usernames.github;
  // TODO: A "change" experience might be slightly different for AAD
  if (config.authentication.scheme === 'aad') {
    return next(utils.wrapError(null, 'Changing a GitHub account is not yet supported.', true));
  }
  if (!(req.legacyUserContext.usernames.azure)) {
    return req.legacyUserContext.render(req, res, 'linkUpdate', `Update your account ${username} by signing in with corporate credentials.`);
  }
  // TODO: NOTE: This will destroy link data not in the session for recreation. May be OK.
  const dc = req.app.settings.dataclient;
  dc.createLinkObjectFromRequest(req, function (error, linkObject) {
    dc.updateLink(req.user.github.id, linkObject, function (updateLinkError) {
      if (updateLinkError) {
        return next(utils.wrapError(updateLinkError, `We had trouble updating the link using a data store API: ${updateLinkError.message}`));
      }
      req.legacyUserContext.saveUserAlert(req, 'Your GitHub account is now associated with the corporate identity for ' + linkObject.aadupn + '.', 'Corporate Identity Link Updated', 'success');
      req.legacyUserContext.invalidateLinkCache(() => {
        res.redirect('/');
      });
    });
  });
});

module.exports = router;
