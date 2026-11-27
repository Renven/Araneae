[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateRange(1, 2147483647)]
    [int]$ProcessId,

    [ValidateRange(1, 3600)]
    [int]$Seconds = 30,

    [ValidateRange(0, 3600)]
    [int]$DelaySeconds = 0
)

$ErrorActionPreference = 'Stop'

function Find-AraneaeProcessIds([int]$RootId, [int]$SessionId) {
    $webviews = @(Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe' AND SessionId = $SessionId")
    $ids = [Collections.Generic.HashSet[int]]::new()
    [void]$ids.Add($RootId)
    foreach ($view in $webviews) {
        if ($view.CommandLine -match '--user-data-dir=(?:"[^"]*com\.shadowspider\.desktop[^"]*"|\S*com\.shadowspider\.desktop\S*)') {
            [void]$ids.Add([int]$view.ProcessId)
        }
    }
    do {
        $changed = $false
        foreach ($view in $webviews) {
            if ($ids.Contains([int]$view.ParentProcessId) -and $ids.Add([int]$view.ProcessId)) {
                $changed = $true
            }
        }
    } while ($changed)
    return ,$ids
}

$root = Get-Process -Id $ProcessId
if ($root.ProcessName -ne 'shadow-spider-desktop') {
    throw "PID $ProcessId is not an Araneae desktop process"
}

if ($DelaySeconds -gt 0) {
    Start-Sleep -Seconds $DelaySeconds
}

$started = Get-Date
$watch = [Diagnostics.Stopwatch]::StartNew()
$previousCpu = @{}
$observedIds = [Collections.Generic.HashSet[int]]::new()
$cpuSeconds = 0.0
$gpuPeak = 0.0
$gpuSamples = 0
$gpuMatches = 0
$gpuErrors = 0
$firstCpuSampleAt = $null

while ($true) {
    $ids = Find-AraneaeProcessIds $ProcessId $root.SessionId
    foreach ($id in $ids) {
        try {
            $process = Get-Process -Id $id
            $birth = $process.StartTime
            $cpu = $process.TotalProcessorTime.TotalSeconds
            if ($id -eq $ProcessId -and $birth -ne $root.StartTime) {
                throw "Araneae PID $ProcessId changed during sampling"
            }
            $key = "$id/$($birth.Ticks)"
            [void]$observedIds.Add($id)
            if ($previousCpu.ContainsKey($key)) {
                $cpuSeconds += [Math]::Max(0.0, $cpu - $previousCpu[$key])
            } elseif ($birth -ge $started) {
                $cpuSeconds += $cpu
            }
            $previousCpu[$key] = $cpu
        } catch {
            if ($id -eq $ProcessId) { throw }
            # A subprocess can exit between the process and CPU queries.
        }
    }

    $cpuSampleAt = $watch.Elapsed.TotalSeconds
    if ($null -eq $firstCpuSampleAt) {
        $firstCpuSampleAt = $cpuSampleAt
    }
    if ($cpuSampleAt - $firstCpuSampleAt -ge $Seconds) { break }

    try {
        # This is the formatted GPU Engine counter provider with locale-independent names.
        $engines = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine
        $gpuSamples++
        foreach ($engine in $engines) {
            if ($engine.Name -match '^pid_(\d+)_' -and $ids.Contains([int]$Matches[1])) {
                $gpuMatches++
                $gpuPeak = [Math]::Max($gpuPeak, [double]$engine.UtilizationPercentage)
            }
        }
    } catch {
        $gpuErrors++
        if ($gpuErrors -eq 1) { Write-Warning $_.Exception.Message }
    }

    $remaining = ($Seconds + $firstCpuSampleAt - $watch.Elapsed.TotalSeconds) * 1000
    if ($remaining -gt 0) { Start-Sleep -Milliseconds ([int][Math]::Min(1000, $remaining)) }
}

[PSCustomObject]@{
    StartedAt = $started.ToString('o')
    ElapsedSeconds = [Math]::Round($cpuSampleAt - $firstCpuSampleAt, 3)
    ProcessIds = @($observedIds | Sort-Object)
    CpuSeconds = [Math]::Round($cpuSeconds, 6)
    GpuPeakPercent = $(if ($gpuSamples -gt 0) { $gpuPeak })
    GpuSamples = $gpuSamples
    GpuEngineMatches = $gpuMatches
    GpuErrors = $gpuErrors
}
