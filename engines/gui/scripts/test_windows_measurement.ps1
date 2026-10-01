param([Parameter(Mandatory=$true)][string]$MeasurementScript)
$ErrorActionPreference='Stop'
$dir=Join-Path $env:TEMP ('gui-guard-test-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($dir)|Out-Null
$exe=Join-Path $dir 'Fixture.exe'
$framework=[Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
$refs=@('System.Drawing','System.Windows.Forms',(Join-Path $framework 'System.Xaml.dll'),(Join-Path $framework 'WPF\WindowsBase.dll'),(Join-Path $framework 'WPF\PresentationCore.dll'),(Join-Path $framework 'WPF\PresentationFramework.dll'))
$source=@'
using System; using System.Windows.Forms;
public class Fixture {
 [STAThread] public static void Main(string[] args) {
  if(args.Length>0 && args[0]=="wpf") {
   var app=new System.Windows.Application();var window=new System.Windows.Window{Title="GUI Guard WPF Fixture",Width=340,Height=220};
   var panel=new System.Windows.Controls.StackPanel();
   var field=new System.Windows.Controls.TextBox{Text="20",Height=28,Width=100};
   var button=new System.Windows.Controls.Button{Content="Save",Height=28,Width=100};
   System.Windows.Automation.AutomationProperties.SetAutomationId(field,"Seconds");
   System.Windows.Automation.AutomationProperties.SetAutomationId(button,"Save");
   panel.Children.Add(field);panel.Children.Add(button);window.Content=panel;
   var timer=new System.Windows.Threading.DispatcherTimer{Interval=TimeSpan.FromSeconds(120)};timer.Tick+=(s,e)=>window.Close();timer.Start();app.Run(window);
  } else {
   var form=new Form{Text="GUI Guard Native Fixture",Width=340,Height=220};
   form.Controls.Add(new TextBox{Text="20",Left=20,Top=40,Width=80,Height=24});
   form.Controls.Add(new Button{Text="Save",Left=120,Top=40,Width=80,Height=24});
   var timer=new Timer{Interval=120000};timer.Tick+=(s,e)=>form.Close();timer.Start();Application.Run(form);
  }
 }
}
'@
$process=$null
try {
 Add-Type -TypeDefinition $source -ReferencedAssemblies $refs -OutputAssembly $exe -OutputType WindowsApplication
 foreach($provider in @('Native','UIAutomation','WinAppCLI')){
  $title='GUI Guard Native Fixture';$arguments=@()
  if($provider -ne 'Native'){$title='GUI Guard WPF Fixture';$arguments=@('wpf')}
  if($arguments.Count){$process=Start-Process -FilePath $exe -ArgumentList $arguments -PassThru}
  else{$process=Start-Process -FilePath $exe -PassThru}
  for($i=0;$i -lt 50;$i++){$process.Refresh();if($process.MainWindowTitle -eq $title){break};Start-Sleep -Milliseconds 100}
  if($provider -eq 'Native'){$targets=@(@{name='seconds';text='20'},@{name='save';text='Save'})}
  else{$targets=@(@{name='seconds';automationId='Seconds'},@{name='save';automationId='Save'})}
  $targetPath=Join-Path $dir 'targets.json';[IO.File]::WriteAllText($targetPath,($targets|ConvertTo-Json),[Text.Encoding]::UTF8)
  $label=$provider.ToLowerInvariant();$nonce=[guid]::NewGuid().ToString('N')
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $MeasurementScript -WindowTitle $title -ExpectedProcessPath $exe -TargetsPath $targetPath -OutputDirectory $dir -Label $label -MeasurementId $nonce -Provider $provider | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Measurement command failed'}
  $record=Get-Content -LiteralPath (Join-Path $dir ($label+'.json')) -Raw|ConvertFrom-Json
  if($record.measurementId -ne $nonce -or $record.controls.Count -ne 2 -or -not $record.runtimeVerified){throw 'Incomplete actual measurement'}
  foreach($c in $record.controls){if($c.width -le 0 -or $c.height -le 0 -or $c.centerY -ne ($c.top+$c.bottom)/2){throw 'Invalid actual bounds'}}
  if($provider -eq 'WinAppCLI'){
   & powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $MeasurementScript -WindowTitle $title -ExpectedProcessPath $exe -TargetsPath $targetPath -OutputDirectory $dir -Label reference -Provider UIAutomation | Out-Null
   if($LASTEXITCODE -ne 0){throw 'Reference measurement failed'}
   $reference=Get-Content -LiteralPath (Join-Path $dir 'reference.json') -Raw|ConvertFrom-Json
   foreach($c in $record.controls){
    $other=$reference.controls|Where-Object {$_.name -eq $c.name}
    foreach($key in @('left','top','right','bottom','width','height','centerX','centerY')){if($c.$key -ne $other.$key){throw "New/reference geometry differs: $($c.name).$key"}}
   }
  }
  Write-Output ($provider+' actual measurement PASS; DPI='+$record.dpiX+'; '+($record.controls|ConvertTo-Json -Compress))
  $process.CloseMainWindow()|Out-Null
  if(-not $process.WaitForExit(3000)){Stop-Process -Id $process.Id -Force};$process=$null
 }
} finally {
 if($process -and -not $process.HasExited){$process.CloseMainWindow()|Out-Null;if(-not $process.WaitForExit(3000)){Stop-Process -Id $process.Id -Force}}
 Remove-Item -LiteralPath $dir -Recurse -Force
}
