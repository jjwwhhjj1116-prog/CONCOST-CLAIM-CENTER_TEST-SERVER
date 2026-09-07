$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$cf115Destination = Join-Path $PSScriptRoot '../tmp/cf115-fixtures/cf115-meeting.wav'
$cf115Speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $cf115Speaker.SelectVoice('Microsoft Heami Desktop')
  $cf115Speaker.Rate = 0
  $cf115Speaker.SetOutputToWaveFile([System.IO.Path]::GetFullPath($cf115Destination))
  $cf115Speaker.Speak('이 녹음은 자동정리 검증용 합성 자료입니다. 실제 업무가 아닙니다. 회의 이름은 시험 도면 검토 회의입니다. 2026년 9월 7일 오전 10시 합성 회의실에서 진행했습니다. 참석자는 김검수와 이확인입니다. 김검수는 9월 9일까지 원도면과 수량을 대조하기로 했습니다. 추가 금액은 아직 확정하지 않았습니다. 누수 여부는 사진만으로 판단할 수 없습니다. 누수 확인 담당자와 다음 회의 날짜는 정하지 않았습니다.')
} finally { $cf115Speaker.Dispose() }
Get-Item -LiteralPath $cf115Destination | Select-Object Name, Length
