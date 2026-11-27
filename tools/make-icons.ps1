# Generates the PNG app icons (Windows, uses System.Drawing). Run: powershell -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\icons'

function New-Icon([int]$size, [string]$file, [bool]$maskable) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $s = $size / 512.0
  $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255,255,154,60)), ([System.Drawing.Color]::FromArgb(255,236,95,18)), 45.0
  function RoundRect($x, $y, $w, $h, $r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x, $y, $r*2, $r*2, 180, 90); $p.AddArc($x+$w-$r*2, $y, $r*2, $r*2, 270, 90)
    $p.AddArc($x+$w-$r*2, $y+$h-$r*2, $r*2, $r*2, 0, 90); $p.AddArc($x, $y+$h-$r*2, $r*2, $r*2, 90, 90)
    $p.CloseFigure(); return $p
  }
  if ($maskable) { $g.FillRectangle($brush, $rect); $k = 0.78; $o = $size * (1 - $k) / 2 } else { $g.FillPath($brush, (RoundRect 0 0 $size $size (120*$s))); $k = 1.0; $o = 0 }
  $t = $s * $k
  $g.FillPath([System.Drawing.Brushes]::White, (RoundRect ($o+136*$t) ($o+104*$t) (240*$t) (304*$t) (36*$t)))
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90,242,113,28)), (22*$t)
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  foreach ($l in @(@(196,328),@(252,328),@(308,272))) { $g.DrawLine($pen, $o+184*$t, $o+$l[0]*$t, $o+$l[1]*$t, $o+$l[0]*$t) }
  $body = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF ($o+300*$t), ($o+372*$t)), (New-Object System.Drawing.PointF ($o+318*$t), ($o+310*$t)),
    (New-Object System.Drawing.PointF ($o+410*$t), ($o+218*$t)), (New-Object System.Drawing.PointF ($o+444*$t), ($o+252*$t)),
    (New-Object System.Drawing.PointF ($o+352*$t), ($o+344*$t)))
  $g.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,58,42,32))), $body)
  $tip = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF ($o+300*$t), ($o+372*$t)), (New-Object System.Drawing.PointF ($o+318*$t), ($o+310*$t)),
    (New-Object System.Drawing.PointF ($o+362*$t), ($o+354*$t)))
  $g.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,255,210,173))), $tip)
  $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

New-Icon 192 'icon-192.png' $false
New-Icon 512 'icon-512.png' $false
New-Icon 512 'icon-maskable-512.png' $true
Write-Output 'Icons generated.'
