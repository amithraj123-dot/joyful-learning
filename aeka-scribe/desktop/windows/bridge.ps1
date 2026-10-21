$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FlowNative {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder b, int size);
 [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
 [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
 [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
 [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public KEYBOARD k; [FieldOffset(0)] public MOUSE m; }
 [StructLayout(LayoutKind.Sequential)] struct MOUSE { public int dx,dy; public uint data,flags,time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] struct KEYBOARD { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
 public static bool Paste() {
  var a=new INPUT[4]; for(int i=0;i<4;i++)a[i].type=1;
  a[0].u.k.vk=0x11; a[1].u.k.vk=0x56; a[2].u.k.vk=0x56;a[2].u.k.flags=2;a[3].u.k.vk=0x11;a[3].u.k.flags=2;
  return SendInput(4,a,Marshal.SizeOf(typeof(INPUT)))==4;
 }
}
'@
function Focus-Info {
 $h=[FlowNative]::GetForegroundWindow();$windowPid=[uint32]0;[void][FlowNative]::GetWindowThreadProcessId($h,[ref]$windowPid)
 $processName='';try{$processName=(Get-Process -Id $windowPid).ProcessName}catch{}
 $isPassword=$true;$selection='';$focusKnown=$false
 try{$el=[System.Windows.Automation.AutomationElement]::FocusedElement;if($null -ne $el){$isPassword=$el.Current.IsPassword;$focusKnown=$true}}catch{}
 return @{handle=$h.ToInt64().ToString();process=$processName;isPassword=$isPassword;focusKnown=$focusKnown;pid=$windowPid}
}
while($null -ne ($line=[Console]::ReadLine())) {
 try {
  $r=$line|ConvertFrom-Json;$result=$null
  switch($r.action) {
   'focus' {$result=Focus-Info}
   'paste' { $f=Focus-Info;if($f.handle -ne $r.handle -or $f.isPassword -or -not $f.focusKnown){throw 'The focused field changed or cannot be checked safely. Copy the text manually.'};if(-not [FlowNative]::Paste()){throw 'Windows blocked text insertion. Copy the text manually.'};$result=@{pasted=$true} }
   'clipboardSequence' {$result=[FlowNative]::GetClipboardSequenceNumber()}
   'holdKey' { $k=$r.key;if($null -eq $k){$k=119};if(-not ($k -is [int] -or $k -is [long]) -or $k -lt 112 -or $k -gt 123){throw 'Unsupported hold-to-talk key.'};$result=([FlowNative]::GetAsyncKeyState([int]$k) -band 0x8000) -ne 0 }
   'selection' { $f=Focus-Info;if($f.isPassword -or -not $f.focusKnown){throw 'Selected text is unavailable in this field.'};$el=[System.Windows.Automation.AutomationElement]::FocusedElement;$pattern=$null;$value='';if($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern,[ref]$pattern)){$ranges=$pattern.GetSelection();foreach($range in $ranges){$value+=$range.GetText(20000)}};$result=@{text=$value;process=$f.process} }
   'call' { $f=Focus-Info;$b=New-Object System.Text.StringBuilder 1000;[void][FlowNative]::GetWindowText([IntPtr]::new([int64]$f.handle),$b,1000);$title=$b.ToString();$candidate=($f.process -match '^(ms-teams|Teams|Zoom|slack|chrome|msedge|firefox)$') -and ($title -match '(?i)(meeting|google meet|zoom meeting|microsoft teams call|huddle)');$result=@{candidate=$candidate;process=$f.process} }
   'verifyInstaller' { $sig=Get-AuthenticodeSignature -LiteralPath ([string]$r.file);$c=$sig.SignerCertificate;$result=@{valid=($sig.Status -eq 'Valid');thumbprint=if($c){$c.Thumbprint}else{''};publisher=if($c){$c.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false)}else{''}} }
   default {throw 'Unknown Windows operation.'}
  }
  @{id=$r.id;result=$result}|ConvertTo-Json -Compress -Depth 5|%{[Console]::WriteLine($_)}
 } catch { @{id=$r.id;error=$_.Exception.Message}|ConvertTo-Json -Compress|%{[Console]::WriteLine($_)} }
}
