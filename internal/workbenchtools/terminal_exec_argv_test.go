package workbenchtools

import (
	"strings"
	"testing"
)

func TestTokenizeExecArgvPythonC(t *testing.T) {
	argv, err := tokenizeExecArgv(`/root/miniconda3/bin/python -c "import torch; print(torch.__version__)"`)
	if err != nil {
		t.Fatal(err)
	}
	if len(argv) != 3 {
		t.Fatalf("argv=%v", argv)
	}
	if argv[2] != "import torch; print(torch.__version__)" {
		t.Fatalf("code=%q", argv[2])
	}
}

func TestTokenizeExecArgvRejectsUnquotedPipe(t *testing.T) {
	_, err := tokenizeExecArgv("ps aux | grep python")
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "|") {
		t.Fatal(err)
	}
}

func TestParseAndValidateExecAllowsUptime(t *testing.T) {
	argv, err := parseAndValidateExec("uptime")
	if err != nil {
		t.Fatal(err)
	}
	if len(argv) != 1 || argv[0] != "uptime" {
		t.Fatalf("argv=%v", argv)
	}
}

func TestParseAndValidateExecRejectsRm(t *testing.T) {
	_, err := parseAndValidateExec("rm -rf /tmp/x")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParseAndValidateExecRejectsChained(t *testing.T) {
	_, err := parseAndValidateExec("uptime; rm -rf /")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParseAndValidateExecAllowsPythonC(t *testing.T) {
	_, err := parseAndValidateExec(`/root/miniconda3/bin/python -c "import torch; print(torch.__version__)"`)
	if err != nil {
		t.Fatal(err)
	}
}

func TestParseAndValidateExecAllowsPipShow(t *testing.T) {
	_, err := parseAndValidateExec("python -m pip show torch")
	if err != nil {
		t.Fatal(err)
	}
}

func TestParseAndValidateExecRejectsDockerRm(t *testing.T) {
	_, err := parseAndValidateExec("docker rm abc")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestPosixQuoteArgvKeepsSemicolonInArg(t *testing.T) {
	got := posixQuoteArgv([]string{"python", "-c", "import torch; print(1)"})
	want := `'python' '-c' 'import torch; print(1)'`
	if got != want {
		t.Fatalf("got %s", got)
	}
}

func TestParseAndValidateExecRejectsPipInstall(t *testing.T) {
	_, err := parseAndValidateExec("python -m pip install torch")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParseAndValidateExecRejectsPythonScript(t *testing.T) {
	_, err := parseAndValidateExec("python /root/train.py")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParseAndValidateExecRejectsPythonWrite(t *testing.T) {
	_, err := parseAndValidateExec(`python -c "open('/tmp/x','w').write('a')"`)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParseAndValidateExecAllowsNvidiaSmi(t *testing.T) {
	if _, err := parseAndValidateExec("nvidia-smi"); err != nil {
		t.Fatal(err)
	}
}
