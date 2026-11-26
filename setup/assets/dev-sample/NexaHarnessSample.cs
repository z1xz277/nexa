using System;
using System.Diagnostics;
using System.IO;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        string html = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "sample.html");
        if (File.Exists(html))
        {
            Process.Start(new ProcessStartInfo(html) { UseShellExecute = true });
        }
    }
}
