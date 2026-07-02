Add-Type -Assembly 'System.Windows.Forms','System.Drawing'
Start-Sleep 3
$s=[System.Windows.Forms.Screen]::PrimaryScreen
$b=New-Object System.Drawing.Bitmap($s.Bounds.Width,$s.Bounds.Height)
$g=[System.Drawing.Graphics]::FromImage($b)
$g.CopyFromScreen($s.Bounds.Location,[System.Drawing.Point]::Empty,$s.Bounds.Size)
$b.Save('C:\Users\Matt\projects\tarot\screenshots\01-miriel-home.png',[System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$b.Dispose()
