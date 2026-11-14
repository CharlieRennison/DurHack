# Shrinks the big source art in "Textures WIP/" to game-sized PNGs in public/assets/tiles/.
# The sources are 1-1.8 MB each; the game only needs ~256 px (ground) / 512 px (sprites).
# Run from the repo root:  powershell -File tools/shrink-textures.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'Textures WIP'
$out = Join-Path $root 'public/assets/tiles'
New-Item -ItemType Directory -Force $out | Out-Null

# source file -> output name, target width
$jobs = @(
  @('my pretty grass.png',        'grass.png',          256),
  @('nice sand.png',              'sand.png',           256),
  @('Water.png',                  'water.png',          256),
  @('sand to grass.png',          'sand_grass.png',     256),
  @('sand to water.jpg',          'sand_water.png',     256),
  @('Water Coral-Straight.png',   'coral_straight.png', 256),
  @('Water Coral-Corner.png',     'coral_corner.png',   256),
  @('Huts.png',                   'huts.png',           768),
  @('Trees.png',                  'trees.png',          1024)
)

foreach ($j in $jobs) {
  $img = [System.Drawing.Image]::FromFile((Join-Path $src $j[0]))
  $w = $j[2]
  $h = [int][Math]::Round($img.Height * $w / $img.Width)
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($img, 0, 0, $w, $h)
  $g.Dispose()
  $bmp.Save((Join-Path $out $j[1]), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose(); $img.Dispose()
  '{0} -> {1} ({2}x{3})' -f $j[0], $j[1], $w, $h
}
