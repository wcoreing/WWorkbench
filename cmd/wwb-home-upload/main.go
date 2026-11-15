package main
import (
  "fmt"; "io"; "os"; "path/filepath"
  pkgsftp "github.com/pkg/sftp"
  "WWorkbench/internal/store"; "WWorkbench/internal/terminal"; "WWorkbench/internal/tunnel"
)
func main() {
  if len(os.Args)<4 { fmt.Fprintln(os.Stderr,"usage: hostId local remote"); os.Exit(2) }
  home,_:=os.UserHomeDir(); st,_:=store.New(filepath.Join(home,".wworkbench")); defer st.Close()
  h,_:=st.GetSSHHost(os.Args[1])
  c,_:=tunnel.DialSSH(nil, terminal.HostToSpec(*h)); defer c.Close()
  s,_:=pkgsftp.NewClient(c); defer s.Close()
  _=s.MkdirAll(filepath.Dir(os.Args[3]))
  src,_:=os.Open(os.Args[2]); defer src.Close()
  dst,_:=s.Create(os.Args[3]); n,_:=io.Copy(dst, src); _=dst.Close()
  fmt.Printf("uploaded %d -> %s\n", n, os.Args[3])
}
