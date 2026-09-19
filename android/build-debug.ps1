param(
    [string]$SdkPath = $env:ANDROID_HOME,
    [string]$JavaPath = $env:JAVA_HOME,
    [switch]$Lint
)
$ErrorActionPreference = 'Stop'
if ($JavaPath) { $env:JAVA_HOME = $JavaPath }
if ($SdkPath) { $env:ANDROID_HOME = $SdkPath }
if (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/java.exe'))) {
    throw 'Set JAVA_HOME to a JDK 17 installation, or pass -JavaPath.'
}
if (-not $env:ANDROID_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME 'platforms/android-36/android.jar'))) {
    throw 'Install Android SDK Platform 36, then set ANDROID_HOME or pass -SdkPath.'
}
# Keep temporary Android and Gradle state inside ignored project directories.
$env:GRADLE_USER_HOME = Join-Path $PSScriptRoot '.gradle-user-home'
$env:ANDROID_USER_HOME = Join-Path $PSScriptRoot '.android-user-home'
$tasks = @(':app:assembleDebug')
if ($Lint) { $tasks += ':app:lintDebug' }
& node (Join-Path $PSScriptRoot '../scripts/build-offline.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Offline asset generation failed.' }
Push-Location -LiteralPath $PSScriptRoot
try {
    & (Join-Path $PSScriptRoot 'gradlew.bat') @tasks '--no-daemon' '--console=plain'
    if ($LASTEXITCODE -ne 0) { throw "Gradle exited with status $LASTEXITCODE" }
    Write-Output (Join-Path $PSScriptRoot 'app/build/outputs/apk/debug/app-debug.apk')
} finally {
    Pop-Location
}
