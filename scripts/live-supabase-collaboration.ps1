param([Parameter(Mandatory = $true)][string]$ProjectRef)

$ErrorActionPreference = "Stop"
$url = "https://$ProjectRef.supabase.co"
$keys = supabase projects api-keys --project-ref $ProjectRef --output json | ConvertFrom-Json
$anon = ($keys | Where-Object name -eq "anon").api_key
$service = ($keys | Where-Object name -eq "service_role").api_key

function Invoke-Api($method, $path, $apiKey, $bearer, $body = $null, $prefer = "") {
  $headers = @{ apikey = $apiKey; Authorization = "Bearer $bearer" }
  if ($prefer) { $headers.Prefer = $prefer }
  $parameters = @{ Method = $method; Uri = "$url$path"; Headers = $headers; ContentType = "application/json" }
  if ($null -ne $body) { $parameters.Body = $body | ConvertTo-Json -Depth 30 -Compress }
  Invoke-RestMethod @parameters
}

$suffix = [guid]::NewGuid().ToString("N").Substring(0, 8)
$password = "Aa1!$suffix"
$users = @()
$projectId = $null
$serverProcess = $null
$stdout = "$env:TEMP\opengantt-collab-out.log"
$stderr = "$env:TEMP\opengantt-collab-err.log"
Remove-Item $stdout, $stderr -Force -ErrorAction SilentlyContinue

try {
  foreach ($kind in @("editor", "viewer")) {
    $email = "og-live-$kind-$suffix@example.com"
    $user = Invoke-Api POST "/auth/v1/admin/users" $service $service @{ email = $email; password = $password; email_confirm = $true }
    $login = Invoke-Api POST "/auth/v1/token?grant_type=password" $anon $anon @{ email = $email; password = $password }
    $users += [pscustomobject]@{ kind = $kind; id = $user.id; email = $email; token = $login.access_token }
  }

  $editor = $users | Where-Object kind -eq "editor"
  $viewer = $users | Where-Object kind -eq "viewer"
  $project = @(Invoke-Api POST "/rest/v1/projects?select=id" $anon $editor.token @{ owner_id = $editor.id; name = "Live Collaboration Test" } "return=representation")
  $projectId = $project[0].id
  $snapshot = @{
    id = $projectId
    name = "Initial live project"
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    defaultCalendarId = "default"
    calendars = @(@{ id = "default"; name = "Standard week"; workingDays = @(1, 2, 3, 4, 5); exceptions = @{} })
    tasks = @()
    dependencies = @()
    commentThreads = @()
  }
  Invoke-Api POST "/rest/v1/project_documents" $anon $editor.token @{ project_id = $projectId; snapshot = $snapshot; revision = 1 } | Out-Null
  Invoke-Api POST "/rest/v1/rpc/invite_project_member" $anon $editor.token @{ target_project = $projectId; member_email = $viewer.email; member_role = "viewer" } | Out-Null

  $env:SUPABASE_URL = $url
  $env:SUPABASE_SERVICE_ROLE_KEY = $service
  $env:COLLAB_PORT = "1235"
  $env:COLLAB_MONITORING_PORT = "1236"
  $env:ALLOWED_ORIGINS = ""
  $serverProcess = Start-Process node.exe -ArgumentList "server-dist/index.js" -WorkingDirectory "." -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $health = $null
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try { $health = Invoke-RestMethod "http://127.0.0.1:1236/health"; if ($health.status -eq "ok") { break } } catch {}
    Start-Sleep -Milliseconds 250
  }
  if ($health.status -ne "ok") { throw "Collaboration health check failed." }

  $env:COLLAB_TEST_URL = "ws://127.0.0.1:1235"
  $env:COLLAB_TEST_PROJECT_ID = $projectId
  $env:COLLAB_TEST_EDITOR_TOKEN = $editor.token
  $env:COLLAB_TEST_VIEWER_TOKEN = $viewer.token
  $result = node scripts/live-collaboration-check.mjs
  if ($LASTEXITCODE -ne 0) { throw "Live collaboration client check failed." }

  Start-Sleep -Seconds 3
  $stored = @(Invoke-Api GET "/rest/v1/project_documents?select=y_state,snapshot&project_id=eq.$projectId" $service $service)
  if (-not $stored[0].y_state) { throw "Yjs state was not persisted." }
  if ($stored[0].snapshot.name -ne "Live collaboration verified") { throw "Materialized snapshot was not persisted." }
  Write-Output $result
  [pscustomobject]@{ Health = $true; YStatePersisted = $true; SnapshotMaterialized = $true } | Format-List
} catch {
  Start-Sleep -Milliseconds 300
  Write-Output "server stdout:"
  if (Test-Path $stdout) { Get-Content $stdout }
  Write-Output "server stderr:"
  if (Test-Path $stderr) { Get-Content $stderr }
  throw
} finally {
  if ($serverProcess) { Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue }
  if ($projectId) { try { Invoke-Api DELETE "/rest/v1/projects?id=eq.$projectId" $service $service | Out-Null } catch {} }
  foreach ($user in $users) { try { Invoke-Api DELETE "/auth/v1/admin/users/$($user.id)" $service $service | Out-Null } catch {} }
  Remove-Item $stdout, $stderr -Force -ErrorAction SilentlyContinue
}
