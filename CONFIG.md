# Introduction

This lists the configuration settings we figured out the app needs so far.

## Misc app-level settings

| Environment variable name | Description                                                                                          |
|---------------------------|------------------------------------------------------------------------------------------------------|
| `DEBUG_ALLOW_HTTP`        | Allows the app to run over HTTP if set to `1`; if not, all HTTP requests will be redirected to HTTPS; useful for running the app locally. |

## GitHub organizations file

While this is needed for the app to boot, there's still a few unknowns:

- what the file is used for;
- what the structure of the JSON file is

| Environment variable name   | Description                                                     |
|-----------------------------|-----------------------------------------------------------------|
| `GITHUB_ORGANIZATIONS_FILE` | The name of a JSON file that must exist in the `data` directory |

## Azure storage account

| Environment variable name | Description                           |
|---------------------------|---------------------------------------|
| `XSTORE_ACCOUNT`          | The name of the Azure storage account |
| `XSTORE_KEY`              | A key to the Azure storage account    |

## Connection to AAD

Most of these variables come from creating an enterprise application in an AAD.

| Environment variable name | Description                                                       |
|---------------------------|-------------------------------------------------------------------|
| `AAD_CLIENT_ID`           | The ID of the enterprise application                              |
| `AAD_CLIENT_SECRET`       | A secret for the enterprise application                           |
| `AAD_TENANT_ID`           | The ID of the AAD (also called tenant)                            |
| `AAD_REDIRECT_URL`        | The redirect URL used when connecting to AAD                      |
| `AAD_ISSUER`              | The issuer of the claims returned by the AAD application          |
| `AAD_BLOCK_GUEST_LINKING` | Blocks linking people who are guests in the AAD if set to `block` |

### Notes

#### `AAD_REDIRECT_URL`

This URL must be configured in the enterprise application, or AAD will throw an error.
It's also hardcoded in the code to be `<root-url>/auth/azure/callback`, so `http://localhost:3000/auth/azure/callback` if you run the app locally.

#### `AAD_ISSUER`

This can be found by using the value of the `issuer` property of either:

- `https://login.microsoftonline.com/<tenant-id>/.well-known/openid-configuration`; or
- `https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration`

If one doesn't work, try the other.

## Connection to GitHub

| Environment variable name | Description                                                          |
|---------------------------|----------------------------------------------------------------------|
| `GITHUB_CLIENT_ID`        | The ID of an OAuth application registered in the GitHub organisation |
| `GITHUB_CLIENT_SECRET`    | A secret for the GitHub OAuth application                            |
| `GITHUB_CALLBACK_URL`     | The redirect URL used when connecting to GitHub                      |

### Notes

#### GITHUB_CALLBACK_URL

This URL must be configured in the GitHub application or it will cause an error.
It's also hardcoded in the code to be `<root-url>/auth/github/callback`, so `http://localhost:3000/auth/github/callback` if you run the app locally.

## Redis

| Environment variable name | Description                                                                                                                  |
|---------------------------|------------------------------------------------------------------------------------------------------------------------------|
| `REDIS_HOST`              | The Redis host if not using SSL (which you should be using); if in Azure, specify `<redis-instance>.redis.cache.windows.net` |
| `REDIS_TLS_HOST`          | The Redis host if using SSL; if in Azure, specify `<redis-instance>.redis.cache.windows.net`                                 |
| `REDIS_KEY`               | A key for the Redis instance                                                                                                 |
| `REDIS_PREFIX`            | Not sure, my guess is it's a prefix for all the keys the app stores in Redis                                                 |

### Notes

It took figuring out you **need** to use the `REDIS_TLS_HOST` if you're using SSL; using `REDIS_HOST` will not work and cause connection errors.

## Graph Provider

The app uses the Graph API for some operations, like figuring out whether someone is a guest in the AAD.

| Environment variable name | Description                                                                                         |
|---------------------------|-----------------------------------------------------------------------------------------------------|
| `GRAPH_PROVIDER`          | The name of the Graph provider                                                                      |
| `GRAPH_AAD_CLIENT_ID`     | The ID of an enterprise application that has application-scoped permissions to access the Graph API |
| `GRAPH_AAD_CLIENT_SECRET` | The secret for the enterprise application                                                           |

### Notes

#### `GRAPH_PROVIDER`

Needs to be `microsoftGraphProvider` as it's the only supported one out of the box (see [code on GitHub](https://github.com/Microsoft/opensource-portal/blob/develop/lib/graphProvider/index.js))