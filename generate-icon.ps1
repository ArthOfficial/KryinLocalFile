$code = @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public class KryinIconGenerator {
    public static void Generate(string pngPath, string icoPath) {
        using (Bitmap bmp = new Bitmap(256, 256, PixelFormat.Format32bppArgb))
        using (Graphics g = Graphics.FromImage(bmp)) {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.Clear(Color.Transparent);

            // Outer rounded container
            Rectangle rect = new Rectangle(14, 14, 228, 228);
            int radius = 52;
            using (GraphicsPath path = new GraphicsPath()) {
                path.AddArc(rect.X, rect.Y, radius, radius, 180, 90);
                path.AddArc(rect.Right - radius, rect.Y, radius, radius, 270, 90);
                path.AddArc(rect.Right - radius, rect.Bottom - radius, radius, radius, 0, 90);
                path.AddArc(rect.X, rect.Bottom - radius, radius, radius, 90, 90);
                path.CloseFigure();

                // Dark navy/slate background gradient
                using (LinearGradientBrush bgBrush = new LinearGradientBrush(
                    new Point(0, 0), new Point(256, 256),
                    Color.FromArgb(255, 11, 19, 38), Color.FromArgb(255, 23, 37, 68))) {
                    g.FillPath(bgBrush, path);
                }

                // Vibrant glowing outer border
                using (Pen glowPen = new Pen(Color.FromArgb(160, 56, 189, 248), 5f)) {
                    g.DrawPath(glowPen, path);
                }
            }

            // Central File Sheet silhouette
            Point[] filePts = new Point[] {
                new Point(70, 58),
                new Point(148, 58),
                new Point(186, 96),
                new Point(186, 198),
                new Point(70, 198)
            };

            using (GraphicsPath filePath = new GraphicsPath()) {
                filePath.AddPolygon(filePts);
                using (LinearGradientBrush fileBrush = new LinearGradientBrush(
                    new Point(70, 58), new Point(186, 198),
                    Color.FromArgb(255, 37, 99, 235), Color.FromArgb(255, 14, 165, 233))) {
                    g.FillPath(fileBrush, filePath);
                }
            }

            // Folded top-right corner
            Point[] cornerPts = new Point[] {
                new Point(148, 58),
                new Point(148, 96),
                new Point(186, 96)
            };
            using (SolidBrush cornerBrush = new SolidBrush(Color.FromArgb(255, 224, 242, 254))) {
                g.FillPolygon(cornerBrush, cornerPts);
            }

            // Minimalist 'K' Logo Mark
            using (Pen kPen = new Pen(Color.White, 16f)) {
                kPen.StartCap = LineCap.Round;
                kPen.EndCap = LineCap.Round;
                // Vertical trunk
                g.DrawLine(kPen, 104, 98, 104, 166);
                // Upper wing
                g.DrawLine(kPen, 104, 132, 148, 100);
                // Lower wing
                g.DrawLine(kPen, 104, 132, 150, 164);
            }

            // Signal Pulse Dot (Active LAN indicator)
            using (SolidBrush dotBrush = new SolidBrush(Color.FromArgb(255, 52, 211, 153))) {
                g.FillEllipse(dotBrush, 172, 172, 24, 24);
            }
            using (Pen dotBorder = new Pen(Color.FromArgb(255, 11, 19, 38), 3f)) {
                g.DrawEllipse(dotBorder, 172, 172, 24, 24);
            }

            // Save PNG
            bmp.Save(pngPath, ImageFormat.Png);

            // Save ICO
            IntPtr hIcon = bmp.GetHicon();
            using (Icon icon = Icon.FromHandle(hIcon))
            using (FileStream fs = new FileStream(icoPath, FileMode.Create)) {
                icon.Save(fs);
            }
        }
    }
}
"@

Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing

[KryinIconGenerator]::Generate('f:\NARCOSTUFF-LAPTOP\Apps\FileManager-Local\public\logo.png', 'f:\NARCOSTUFF-LAPTOP\Apps\FileManager-Local\public\favicon.ico')
Copy-Item 'f:\NARCOSTUFF-LAPTOP\Apps\FileManager-Local\public\favicon.ico' 'f:\NARCOSTUFF-LAPTOP\Apps\FileManager-Local\app-icon.ico' -Force
Write-Output "Successfully generated custom Kryin logo PNG and ICO."
