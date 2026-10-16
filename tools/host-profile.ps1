$ErrorActionPreference='Stop'
$profileRoot=Split-Path -Parent $PSScriptRoot
$cpu=@(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors)
$machine=Get-CimInstance Win32_ComputerSystem
$gpu=@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,VideoProcessor)
$browsers=@{}
$candidates=@{
    chrome=(Join-Path $env:ProgramFiles 'Google/Chrome/Application/chrome.exe')
    edge=(Join-Path ${env:ProgramFiles(x86)} 'Microsoft/Edge/Application/msedge.exe')
    firefox=(Join-Path $env:ProgramFiles 'Mozilla Firefox/firefox.exe')
}
foreach($browserName in $candidates.Keys) {
    $browserFile=$candidates[$browserName]
    if(Test-Path -LiteralPath $browserFile) { $browsers[$browserName]=(Get-Item -LiteralPath $browserFile).VersionInfo.ProductVersion }
}
$report=[ordered]@{
    capturedAt=(Get-Date).ToUniversalTime().ToString('o')
    cpu=$cpu
    memoryBytes=$machine.TotalPhysicalMemory
    gpu=$gpu
    browsers=$browsers
    targetResolution='1920x1080'
    targetSimulationHz=30
    targetRenderHz=60
    benchmarkWorldAvailable=$false
    performanceAccepted=$false
    note='Hardware inventory only. The asset viewer and finiteuses scene do not establish full-game FPS, tick latency or memory acceptance.'
}
$profileOutput=Join-Path $profileRoot 'output/host-profile.json'
New-Item -ItemType Directory -Path (Split-Path -Parent $profileOutput) -Force | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $profileOutput -Encoding utf8
Get-Content -LiteralPath $profileOutput
