param([ValidateSet('setup','build','serve','check')][string]$Action='serve')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$runtimeRoot=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies'
$pythonCandidates=@(
    (Join-Path $runtimeRoot 'python/python.exe'),
    (Join-Path $env:USERPROFILE '.cache/dst-wasm-tools/emsdk/python/3.13.3_64bit/python.exe')
)
$pythonPath=$pythonCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if(-not $pythonPath) {
    $pythonCommand=Get-Command python -ErrorAction SilentlyContinue
    if($pythonCommand -and (Get-Item -LiteralPath $pythonCommand.Source).Length -gt 10000) { $pythonPath=$pythonCommand.Source }
}
if(-not $pythonPath) { throw 'Python 3.12+ is required.' }
$nodePath=Join-Path $env:ProgramFiles 'nodejs/node.exe'
if(-not (Test-Path -LiteralPath $nodePath)) { $nodePath=Join-Path $runtimeRoot 'node/bin/node.exe' }
if(-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js 22+ is required.' }
$npmPath=Join-Path $env:ProgramFiles 'nodejs/npm.cmd'
if(-not (Test-Path -LiteralPath $npmPath)) { throw 'npm is required.' }
$env:PATH="$(Split-Path -Parent $nodePath);$env:PATH"
function Invoke-Python([string[]]$Arguments) { & $pythonPath @Arguments; if($LASTEXITCODE -ne 0) { throw 'Python step failed.' } }
function Invoke-Npm([string[]]$Arguments) { & $npmPath @Arguments; if($LASTEXITCODE -ne 0) { throw 'npm step failed.' } }
function Setup-Project {
    Invoke-Python @('tools/setup.py')
    Invoke-Npm @('ci')
}
function Build-Project {
    if(-not (Test-Path -LiteralPath 'vendor/rapidxml-1.13/rapidxml.hpp')) { Invoke-Python @('tools/setup.py') }
    if(-not (Test-Path -LiteralPath '.cache/tools.json') -or -not (Test-Path -LiteralPath 'vendor/lua-5.1.5/src/lua.h') -or -not (Test-Path -LiteralPath 'vendor/LuaBitOp-1.0.4/bit.c') -or -not (Test-Path -LiteralPath 'vendor/dr_libs/dr_flac.h')) { Invoke-Python @('tools/setup.py') }
    if(-not (Test-Path -LiteralPath 'node_modules/vite')) { Invoke-Npm @('ci') }
    Invoke-Python @('tools/verify_originals.py')
    Invoke-Python @('tools/prepare.py')
    Invoke-Python @('tools/assets.py')
    Invoke-Python @('tools/resources.py')
    Invoke-Python @('tools/atlas_catalog.py')
    Invoke-Python @('tools/ui_transform_catalog.py')
    Invoke-Python @('tools/shader_catalog.py')
    Invoke-Python @('tools/texture_catalog.py')
    Invoke-Python @('tools/animation_catalog.py')
    Invoke-Python @('tools/asset_type_catalog.py')
    Invoke-Python @('tools/font_catalog.py')
    Invoke-Python @('tools/build.py')
    Invoke-Npm @('run','build')
}
switch($Action) {
    'setup' { Setup-Project }
    'build' { Build-Project }
    'check' {
        Invoke-Python @('tools/verify_originals.py')
        Invoke-Python @('tools/atlas_catalog.py')
        Invoke-Python @('tools/ui_transform_catalog.py')
        Invoke-Python @('tools/shader_catalog.py')
        Invoke-Python @('tools/texture_catalog.py')
        Invoke-Python @('tools/animation_catalog.py')
        Invoke-Python @('tools/asset_type_catalog.py')
        Invoke-Python @('tools/font_catalog.py')
        Invoke-Python @('-m','unittest','discover','-s','tests','-p','*_test.py')
        Invoke-Npm @('test')
        & $nodePath tools/bootstrap-gap.mjs
        if($LASTEXITCODE -ne 0) { throw 'Bootstrap gap inspection failed.' }
    }
    'serve' {
        if(-not (Test-Path -LiteralPath 'dist/index.html')) { Build-Project }
        & $nodePath tools/signaling.mjs
    }
}
