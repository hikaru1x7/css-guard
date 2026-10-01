param(
 [Parameter(Mandatory=$true)][string]$WindowTitle,
 [Parameter(Mandatory=$true)][string]$ExpectedProcessPath,
 [Parameter(Mandatory=$true)][string]$TargetsPath,
 [Parameter(Mandatory=$true)][string]$OutputDirectory,
 [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$Label='before',
 [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$MeasurementId=([guid]::NewGuid().ToString('N')),
 [ValidateSet('Native','UIAutomation','WinAppCLI')][string]$Provider='Native',
 [string]$WinAppPath,
 [string]$DisplayState='default',
 [switch]$AllowDownloads
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing,System.Windows.Forms
if($Provider -eq 'UIAutomation'){Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes}
Add-Type -ReferencedAssemblies System.Drawing @'
using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Drawing;
public class GuiMeasure {
 public delegate bool EnumProc(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)]public struct Rect{public int L,T,R,B;}
 public class Row{public long handle;public string text,className;public int left,top,right,bottom,width,height;public double centerX,centerY;public string fontFamily;public float fontPoints;}
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern IntPtr FindWindow(IntPtr c,string t);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")]static extern bool EnumChildWindows(IntPtr h,EnumProc f,IntPtr p);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")]public static extern int GetWindowThreadProcessId(IntPtr h,out int id);
 [DllImport("user32.dll")]public static extern IntPtr GetParent(IntPtr h);
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")]static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr a,IntPtr b);
 [DllImport("user32.dll")]static extern bool PrintWindow(IntPtr h,IntPtr dc,uint f);
 [DllImport("user32.dll")]public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")]public static extern uint GetDpiForWindow(IntPtr h);
 public static Row Read(IntPtr h){if(h==IntPtr.Zero||!IsWindowVisible(h))throw new Exception("Target is not visible");Rect r;if(!GetWindowRect(h,out r))throw new Exception("No bounds");var t=new StringBuilder(1024);var c=new StringBuilder(256);GetWindowText(h,t,t.Capacity);GetClassName(h,c,c.Capacity);var row=new Row{handle=h.ToInt64(),text=t.ToString(),className=c.ToString(),left=r.L,top=r.T,right=r.R,bottom=r.B,width=r.R-r.L,height=r.B-r.T,centerX=(r.L+r.R)/2.0,centerY=(r.T+r.B)/2.0};var font=SendMessage(h,0x31,IntPtr.Zero,IntPtr.Zero);if(font!=IntPtr.Zero){using(var f=Font.FromHfont(font)){row.fontFamily=f.Name;row.fontPoints=f.SizeInPoints;}}return row;}
 public static Row[] Children(IntPtr h){var rows=new List<Row>();EnumChildWindows(h,delegate(IntPtr c,IntPtr p){if(IsWindowVisible(c))rows.Add(Read(c));return true;},IntPtr.Zero);return rows.ToArray();}
 public static void Capture(IntPtr h,string path){Rect r;if(!GetWindowRect(h,out r))throw new Exception("No window bounds");using(var b=new Bitmap(r.R-r.L,r.B-r.T))using(var g=Graphics.FromImage(b)){var dc=g.GetHdc();bool ok;try{ok=PrintWindow(h,dc,2);}finally{g.ReleaseHdc(dc);}if(!ok)throw new Exception("Window image capture failed");b.Save(path,System.Drawing.Imaging.ImageFormat.Png);}}
}
'@
$oldDpi=[GuiMeasure]::SetThreadDpiAwarenessContext([IntPtr](-4))
if($oldDpi -eq [IntPtr]::Zero){throw 'Cannot enable physical-pixel DPI measurement'}
try {
$h=[GuiMeasure]::FindWindow([IntPtr]::Zero,$WindowTitle)
if($h -eq [IntPtr]::Zero -or -not [GuiMeasure]::IsWindowVisible($h) -or [GuiMeasure]::IsIconic($h)){throw 'Target window is missing, hidden or minimized'}
$processId=0;[GuiMeasure]::GetWindowThreadProcessId($h,[ref]$processId)|Out-Null
$owner=Get-Process -Id $processId
if(-not [string]::Equals($owner.Path,$ExpectedProcessPath,[StringComparison]::OrdinalIgnoreCase)){throw 'Window belongs to a different executable'}
$binary=Get-Item -LiteralPath $owner.Path
if($binary.LastWriteTimeUtc -gt $owner.StartTime.ToUniversalTime()){throw 'Executable was replaced after this process started; measure the updated running application'}
$binaryHash=(Get-FileHash -LiteralPath $owner.Path -Algorithm SHA256).Hash.ToLowerInvariant()
$definitions=Get-Content -LiteralPath $TargetsPath -Raw -Encoding UTF8|ConvertFrom-Json
if($definitions.Count -eq 0){throw 'No targets specified'}
$all=[GuiMeasure]::Children($h);$controls=@();$names=@{}
if($Provider -eq 'WinAppCLI'){
 if(-not $WinAppPath){
  $runtime=Join-Path $PSScriptRoot '..\.runtime'
  $pointer=Get-Content -LiteralPath (Join-Path $runtime 'winapp-current.json') -Raw|ConvertFrom-Json
  $WinAppPath=$pointer.executable
  if(-not $WinAppPath){$WinAppPath=Join-Path (Join-Path $runtime $pointer.directory) 'winapp.exe'}
 }
 if(-not (Test-Path -LiteralPath $WinAppPath -PathType Leaf)){throw 'Run gui-guard update before measuring with WinAppCLI'}
 $env:WINAPP_CLI_TELEMETRY_OPTOUT='1'
 $winappStatus=& $WinAppPath ui status -w $h.ToInt64() --json
 if($LASTEXITCODE -ne 0){throw 'WinApp CLI could not verify the target window'}
 $winappStatus=($winappStatus -join "`n")|ConvertFrom-Json
 if($winappStatus.hwnd -ne $h.ToInt64() -or $winappStatus.processId -ne $processId -or $winappStatus.coordinateSpace -ne 'physical-screen-pixels' -or $winappStatus.windowDpi -ne [GuiMeasure]::GetDpiForWindow($h)){throw 'WinApp CLI returned a different window or coordinate space'}
}
if($Provider -eq 'UIAutomation'){
 $uiaWindow=[Windows.Automation.AutomationElement]::FromHandle($h)
 $uiaAll=$uiaWindow.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
}
foreach($target in $definitions){
 if(-not $target.name -or $names.ContainsKey([string]$target.name)){throw 'Missing or duplicate target name'};$names[[string]$target.name]=$true
 if($Provider -eq 'WinAppCLI'){
  if($target.parentLevels -or $null -ne $target.ordinal){throw 'WinAppCLI needs a unique selector for the actual target; parentLevels/ordinal are not supported'}
  $selector=$target.selector;if(-not $selector){$selector=$target.automationId}
  if(-not $selector){throw 'WinAppCLI target requires selector or automationId'}
  $search=& $WinAppPath ui search $selector -w $h.ToInt64() --max 2 --json
  if($LASTEXITCODE -ne 0){throw "WinApp CLI search failed: $($target.name)"}
  $search=($search -join "`n")|ConvertFrom-Json
  if($search.matchCount -ne 1 -or $search.hasMore){throw "Missing or ambiguous WinApp CLI target: $($target.name)"}
  $found=$search.matches[0]
  $result=& $WinAppPath ui get-property $found.selector -w $h.ToInt64() --json
  if($LASTEXITCODE -ne 0){throw "WinApp CLI measurement failed: $($target.name)"}
  $result=($result -join "`n")|ConvertFrom-Json
  $element=$result.element
  if($null -eq $element -or (($element.selector -ne $found.selector) -and (-not $found.automationId -or $element.automationId -ne $found.automationId)) -or $element.isOffscreen -or $element.width -le 0 -or $element.height -le 0){throw 'WinApp CLI target is missing or invisible'}
  foreach($key in @('x','y','width','height')){
   $value=$element.$key
   if($null -eq $value -or $value -is [string] -or [double]::IsNaN([double]$value) -or [double]::IsInfinity([double]$value) -or $value -ne $found.$key){throw 'WinApp CLI geometry is invalid or the target moved'}
  }
  $fontFamily=$result.properties.FontName
  if($fontFamily -in @('Mixed','NotSupported','Unavailable','')){$fontFamily=$null}
  $fontPoints=$null;$parsedFont=0.0
  if([double]::TryParse([string]$result.properties.FontSize,[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture,[ref]$parsedFont) -and $parsedFont -gt 0){$fontPoints=$parsedFont}
  $controls+=@([pscustomobject]@{name=[string]$target.name;selector=$element.selector;text=$element.name;value=$element.value;className=$result.properties.ClassName;left=$element.x;top=$element.y;right=($element.x+$element.width);bottom=($element.y+$element.height);width=$element.width;height=$element.height;centerX=($element.x+$element.width/2);centerY=($element.y+$element.height/2);fontFamily=$fontFamily;fontPoints=$fontPoints})
  continue
 }
 if($Provider -eq 'UIAutomation'){
  $matches=@($uiaAll|Where-Object {-not $_.Current.IsOffscreen -and (($_.Current.Name -eq $target.text) -or ($target.automationId -and $_.Current.AutomationId -eq $target.automationId)) -and (-not $target.className -or $_.Current.ClassName -eq $target.className)})
  if($matches.Count -eq 0){throw "Missing UI Automation target: $($target.name)"}
  if($null -eq $target.ordinal -and $matches.Count -ne 1){throw "Ambiguous UI Automation target: $($target.name)"}
  $index=0;if($null -ne $target.ordinal){$index=[int]$target.ordinal}
  if($index -lt 0 -or $index -ge $matches.Count){throw 'Target ordinal is out of range'}
  $element=$matches[$index];$levels=0;if($null -ne $target.parentLevels){$levels=[int]$target.parentLevels}
  if($levels -lt 0){throw 'Negative parentLevels'}
  for($i=0;$i -lt $levels;$i++){
   $element=[Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($element)
   if($null -eq $element -or $element.Equals($uiaWindow)){throw 'Target ascends outside a control'}
  }
  $bounds=$element.Current.BoundingRectangle
  if($element.Current.IsOffscreen -or $bounds.IsEmpty -or $bounds.Width -le 0 -or $bounds.Height -le 0){throw 'Target has no visible bounds'}
  $fontFamily=$null;$fontPoints=$null;$textPattern=$null
  if($element.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern,[ref]$textPattern)){
   $fontFamily=$textPattern.DocumentRange.GetAttributeValue([Windows.Automation.TextPattern]::FontNameAttribute)
   $fontPoints=$textPattern.DocumentRange.GetAttributeValue([Windows.Automation.TextPattern]::FontSizeAttribute)
   if($fontFamily -isnot [string]){$fontFamily=$null};if($fontPoints -isnot [double]){$fontPoints=$null}
  }
  $controls+=@([pscustomobject]@{name=[string]$target.name;automationId=$element.Current.AutomationId;text=$element.Current.Name;className=$element.Current.ClassName;left=$bounds.Left;top=$bounds.Top;right=$bounds.Right;bottom=$bounds.Bottom;width=$bounds.Width;height=$bounds.Height;centerX=($bounds.Left+$bounds.Right)/2;centerY=($bounds.Top+$bounds.Bottom)/2;fontFamily=$fontFamily;fontPoints=$fontPoints})
  continue
 }
 $matches=@($all|Where-Object {$_.text -eq $target.text -and (-not $target.className -or $_.className -eq $target.className)})
 if($matches.Count -eq 0){throw "Missing target: $($target.name)"}
 if($null -eq $target.ordinal -and $matches.Count -ne 1){throw "Ambiguous target: $($target.name)"}
 $index=0;if($null -ne $target.ordinal){$index=[int]$target.ordinal};if($index -lt 0 -or $index -ge $matches.Count){throw 'Target ordinal is out of range'}
 $handle=[IntPtr]$matches[$index].handle;$levels=0;if($null -ne $target.parentLevels){$levels=[int]$target.parentLevels};if($levels -lt 0){throw 'Negative parentLevels'}
 for($i=0;$i -lt $levels;$i++){$handle=[GuiMeasure]::GetParent($handle);if($handle -eq $h){throw 'Target ascends to the window rather than a control'}}
 $row=[GuiMeasure]::Read($handle)
 $controls+=@([pscustomobject]@{name=[string]$target.name;handle=$row.handle;text=$row.text;className=$row.className;left=$row.left;top=$row.top;right=$row.right;bottom=$row.bottom;width=$row.width;height=$row.height;centerX=$row.centerX;centerY=$row.centerY;fontFamily=$row.fontFamily;fontPoints=$row.fontPoints})
}
$directory=[IO.Path]::GetFullPath($OutputDirectory)
$downloads=Join-Path ([Environment]::GetFolderPath('UserProfile')) Downloads
if(-not $AllowDownloads -and ($directory.TrimEnd('\') -eq $downloads -or $directory.StartsWith($downloads+'\',[StringComparison]::OrdinalIgnoreCase))){throw 'Choose a project output directory, not Downloads'}
[IO.Directory]::CreateDirectory($directory)|Out-Null
$imagePath=Join-Path $directory ($Label+'.png');[GuiMeasure]::Capture($h,$imagePath)
$window=[GuiMeasure]::Read($h)
$dpiX=[GuiMeasure]::GetDpiForWindow($h);$dpiY=$dpiX
if($dpiX -le 0){throw 'Cannot measure window DPI'}
$record=[pscustomobject]@{measurementId=$MeasurementId;measuredAt=[datetime]::UtcNow.ToString('o');processId=$processId;processStartedAt=$owner.StartTime.ToUniversalTime().ToString('o');executable=$owner.Path;binarySha256=$binaryHash;runtimeVerified=$true;provider=$Provider;displayState=$DisplayState;window=$window;dpiX=$dpiX;dpiY=$dpiY;image=$imagePath;controls=$controls}
if($Provider -eq 'WinAppCLI'){$record|Add-Member -NotePropertyName measurementTool -NotePropertyValue @{name='WinAppCLI';binarySha256=(Get-FileHash -LiteralPath $WinAppPath -Algorithm SHA256).Hash.ToLowerInvariant()}}
$json=$record|ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $directory ($Label+'.json')),$json,(New-Object Text.UTF8Encoding($false)))
$json
} finally {[GuiMeasure]::SetThreadDpiAwarenessContext($oldDpi)|Out-Null}
