Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$outputDir = "C:\Users\Matt\projects\tarot\screenshots"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

function Take-Screenshot($filename) {
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen
    $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
    $path = Join-Path $outputDir $filename
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Host "Saved: $path"
}

# Give time to switch to Firefox
Write-Host "Taking screenshot in 5 seconds - minimize File Explorer now!"
Start-Sleep -Seconds 5
Take-Screenshot "01-miriel-home.png"

Write-Host "Done! Screenshots saved to $outputDir"
Start-Sleep -Seconds 2
