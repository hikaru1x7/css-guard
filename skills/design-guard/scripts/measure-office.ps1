param(
 [Parameter(Mandatory=$true)][string]$InputDocument,
 [Parameter(Mandatory=$true)][string]$TargetsPath,
 [Parameter(Mandatory=$true)][string]$OutputDirectory,
 [Parameter(Mandatory=$true)][string]$Label,
 [switch]$ShowMeasurementWindow
)
$ErrorActionPreference='Stop'
if ($Label -notmatch '^[A-Za-z0-9_-]+$') {throw 'Use an alphanumeric measurement label.'}
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem
$source=(Resolve-Path -LiteralPath $InputDocument).Path
$targets=@(Get-Content -LiteralPath $TargetsPath -Raw -Encoding UTF8 | ConvertFrom-Json | ForEach-Object {$_})
if ($targets.Count -lt 2 -or @($targets.name | Sort-Object -Unique).Count -ne $targets.Count) {throw 'Provide unique target and comparison names (at least two).'}
$ext=[IO.Path]::GetExtension($source).ToLowerInvariant()
if ($ext -eq '.docx' -and -not $ShowMeasurementWindow) {throw 'Word native page imaging needs an explicitly requested measurement window; use -ShowMeasurementWindow.'}
if ($ext -notin @('.docx','.pptx')) {throw 'This adapter supports docx/pptx; use a suitable adapter for other formats.'}
$processName=if($ext -eq '.docx'){'WINWORD'}else{'POWERPNT'}
if (Get-Process -Name $processName -ErrorAction SilentlyContinue) {throw 'An existing Office application is running; preserve it and use another read-only measurement route.'}
# No automatic refresh of external linked content during measurement.
$zip=[IO.Compression.ZipFile]::OpenRead($source)
try {
 foreach ($entry in $zip.Entries) {
  if ($entry.FullName.EndsWith('.rels') -or ($entry.FullName.StartsWith('word/') -and $entry.FullName.EndsWith('.xml'))) {
   $reader=[IO.StreamReader]::new($entry.Open());try {$xml=[xml]$reader.ReadToEnd()} finally {$reader.Dispose()}
   foreach ($rel in $xml.SelectNodes('//*[@TargetMode="External"]')) {
    if (-not $rel.Type.EndsWith('/hyperlink')) {throw 'Externally linked content needs a separately authorized measurement procedure.'}
   }
   foreach ($field in $xml.SelectNodes('//*[local-name()="instrText"]')) {
    if ($field.InnerText -match '(?i)\b(DDE|DDEAUTO|INCLUDETEXT|INCLUDEPICTURE)\b') {throw 'External Word fields need a separately authorized measurement procedure.'}
   }
  }
 }
} finally {$zip.Dispose()}
$hash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
$dest=[IO.Path]::GetFullPath($OutputDirectory)
if ($dest -match '(?i)[\\/]Downloads(?:[\\/]|$)') {throw 'Choose a project evidence directory, not Downloads.'}
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$nonce=[Guid]::NewGuid().ToString('N')
$app=$null;$document=$null;$owned=$false;$oldLinks=$null
$measured=@();$pages=@{};$version=$null
try {
 if ($ext -eq '.docx') {
  $app=New-Object -ComObject Word.Application
  if ($app.Documents.Count -ne 0) {throw 'An existing Word session has open documents; preserve it and use another authorized measurement route.'}
  $owned=$true;$app.Visible=$true;$app.DisplayAlerts=0;$app.AutomationSecurity=3
  $oldLinks=$app.Options.UpdateLinksAtOpen;$app.Options.UpdateLinksAtOpen=$false
  $document=$app.Documents.Open($source,$false,$true,$false)
  $window=$document.ActiveWindow;$window.View.Type=3;$window.View.Zoom.Percentage=100
  $document.Repaginate();$version=$app.Version
  foreach ($target in $targets) {
   if ([string]::IsNullOrEmpty($target.text)) {throw 'Word targets require exact text.'}
   $range=$document.Content.Duplicate
   $range.Find.ClearFormatting();$range.Find.Text=[string]$target.text
   $range.Find.MatchCase=$true;$range.Find.MatchWildcards=$false;$range.Find.Wrap=0
   if (-not $range.Find.Execute()) {throw "Word target not found: $($target.name)"}
   $next=$document.Range($range.End,$document.Content.End)
   $next.Find.Text=[string]$target.text;$next.Find.MatchCase=$true;$next.Find.Wrap=0
   if ($next.Find.Execute()) {throw "Ambiguous Word target: $($target.name)"}
   $window.ScrollIntoView($range,$true)
   $left=0;$top=0;$width=0;$height=0
   $window.GetPoint([ref]$left,[ref]$top,[ref]$width,[ref]$height,$range)
   $x=[double]$range.Information(5);$y=[double]$range.Information(6)
   if ($x -lt 0 -or $y -lt 0 -or $width -le 0 -or $height -le 0) {throw "Not visibly measurable: $($target.name)"}
   $page=[int]$range.Information(3)
   $measured+=@{name=$target.name;text=$range.Text;page=$page;rangeInformationPt=@($x,$y);screenBoxPx=@($left,$top,$width,$height);font=$range.Font.Name;fontSizePt=$range.Font.Size}
   $pages[$page]=$true
  }
  foreach ($page in @($pages.Keys | Sort-Object)) {
   [byte[]]$bits=$window.Panes.Item(1).Pages.Item([int]$page).EnhMetaFileBits
   $stream=[IO.MemoryStream]::new($bits);$metafile=[Drawing.Imaging.Metafile]::new($stream)
   # EMF's own page bounds handle mixed page sizes; do not assume section 1 geometry.
   $unit=[Drawing.GraphicsUnit]::Pixel;$bounds=$metafile.GetBounds([ref]$unit)
   $w=[int][Math]::Ceiling($bounds.Width);$h=[int][Math]::Ceiling($bounds.Height)
   if ($w -le 0 -or $h -le 0) {throw 'Empty Word page image.'}
   $bitmap=[Drawing.Bitmap]::new($w,$h);$graphics=[Drawing.Graphics]::FromImage($bitmap)
   try {$graphics.Clear([Drawing.Color]::White);$graphics.DrawImage($metafile,[Drawing.Rectangle]::new(0,0,$w,$h));$bitmap.Save((Join-Path $dest "$Label-$nonce-page-$page.png"),[Drawing.Imaging.ImageFormat]::Png)}
   finally {$graphics.Dispose();$bitmap.Dispose();$metafile.Dispose();$stream.Dispose()}
  }
  $pageCount=$document.ComputeStatistics(2)
 } else {
  $app=New-Object -ComObject PowerPoint.Application
  if ($app.Presentations.Count -ne 0) {throw 'An existing PowerPoint session has open presentations; preserve it and use another authorized measurement route.'}
  $owned=$true;$app.AutomationSecurity=3;$version=$app.Version
  $document=$app.Presentations.Open($source,-1,0,0)
  foreach ($target in $targets) {
   if (-not $target.slide -or [string]::IsNullOrEmpty($target.shape)) {throw 'PowerPoint targets require slide and exact shape name.'}
   $slide=$document.Slides.Item([int]$target.slide)
   $matches=@($slide.Shapes | Where-Object {$_.Name -ceq [string]$target.shape})
   if ($matches.Count -ne 1) {throw "Missing/ambiguous PowerPoint target: $($target.name)"}
   $shape=$matches[0];$textBox=$null;$text=$null
   if ($shape.HasTextFrame -ne 0 -and $shape.TextFrame2.HasText -ne 0) {
    $text=$shape.TextFrame2.TextRange
    $textBox=@([double]$text.BoundLeft,[double]$text.BoundTop,[double]$text.BoundWidth,[double]$text.BoundHeight)
   }
   $measured+=@{name=$target.name;slide=[int]$target.slide;frameBoxPt=@([double]$shape.Left,[double]$shape.Top,[double]$shape.Width,[double]$shape.Height);textBoxPt=$textBox;text=if($null -ne $text){$text.Text}else{$null};rotation=$shape.Rotation}
   $pages[[int]$target.slide]=$true
  }
  $w=[int][Math]::Round($document.PageSetup.SlideWidth*96/72);$h=[int][Math]::Round($document.PageSetup.SlideHeight*96/72)
  foreach ($page in @($pages.Keys | Sort-Object)) {$document.Slides.Item([int]$page).Export((Join-Path $dest "$Label-$nonce-slide-$page.png"),'PNG',$w,$h)}
  $pageCount=$document.Slides.Count
 }
 if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) {throw 'Source changed during measurement.'}
 $images=@(Get-ChildItem -LiteralPath $dest -Filter "$Label-$nonce-*.png" | ForEach-Object {@{path=$_.FullName;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}})
 $result=@{source=$source;sourceSha256=$hash;renderer=if($ext -eq '.docx'){'Microsoft Word'}else{'Microsoft PowerPoint'};version=$version;measurementId=$nonce;measuredAt=[DateTime]::UtcNow.ToString('o');label=$Label;pageCount=$pageCount;targets=$measured;images=$images;pixelGlyphBoundsVerified=$false}
 $record=Join-Path $dest "$Label.json"
 $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $record -Encoding UTF8
 Write-Output $record
} finally {
 if ($null -ne $document) {if($ext -eq '.docx'){$document.Close(0)}else{$document.Close()}}
 if ($null -ne $app -and $owned) {
  if ($null -ne $oldLinks) {$app.Options.UpdateLinksAtOpen=$oldLinks}
  $app.Quit()
 }
}
