$ErrorActionPreference = 'Stop'
$oauthStatePath = Join-Path $env:TEMP 'vocametrix-chatgpt-oauth.clixml'
$oauthProtected = Import-Clixml -LiteralPath $oauthStatePath
$oauthConfig = ([System.Net.NetworkCredential]::new('', $oauthProtected)).Password | ConvertFrom-Json
$oauthSettings = @($oauthConfig.PSObject.Properties | ForEach-Object { $_.Name + '=' + [string]$_.Value })
if ($oauthSettings.Count -ne 6) { throw 'Expected six prepared OAuth settings.' }

$azureCli = 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd'
& $azureCli account set --subscription '2ba93042-3cda-4de9-89ac-a7e35ae3c290'
if ($LASTEXITCODE -ne 0) { throw 'Azure subscription selection failed.' }
# Run only immediately after the Azure password helper confirms this operation.
& $azureCli webapp config appsettings set --subscription '2ba93042-3cda-4de9-89ac-a7e35ae3c290' --resource-group 'vocametrix-azure-sponsorship' --name 'webapp-platform-vocametrix' --settings $oauthSettings --output none
if ($LASTEXITCODE -ne 0) { throw 'Azure OAuth configuration failed.' }
Write-Output 'Platform OAuth settings configured.'
