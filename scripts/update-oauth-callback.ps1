$ErrorActionPreference = 'Stop'
$azureCli = 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd'
& $azureCli account set --subscription '2ba93042-3cda-4de9-89ac-a7e35ae3c290'
if ($LASTEXITCODE -ne 0) { throw 'Azure subscription selection failed.' }
# Requires a fresh Azure password confirmation immediately before execution.
& $azureCli webapp config appsettings set --subscription '2ba93042-3cda-4de9-89ac-a7e35ae3c290' --resource-group 'vocametrix-azure-sponsorship' --name 'webapp-platform-vocametrix' --settings 'MCP_OAUTH_REDIRECT_URI=https://chatgpt.com/connector_platform_oauth_redirect' --output none
if ($LASTEXITCODE -ne 0) { throw 'OAuth callback update failed.' }
$oauthStatePath = Join-Path $env:TEMP 'vocametrix-chatgpt-oauth.clixml'
$oauthProtected = Import-Clixml -LiteralPath $oauthStatePath
$oauthConfig = ([System.Net.NetworkCredential]::new('', $oauthProtected)).Password | ConvertFrom-Json
$oauthConfig.MCP_OAUTH_REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect'
$oauthConfig | ConvertTo-Json -Compress | ConvertTo-SecureString -AsPlainText -Force | Export-Clixml -LiteralPath $oauthStatePath
Write-Output 'OAuth callback updated to the URI observed in ChatGPT.'
