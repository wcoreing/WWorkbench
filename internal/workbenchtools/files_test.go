package workbenchtools

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"WWorkbench/internal/agentcap"
	"WWorkbench/internal/notebook"
)

func TestCleanFileRelRejectsEscape(t *testing.T) {
	if _, err := cleanFileRel("../outside"); err == nil {
		t.Fatal("expected escape")
	}
	if _, err := cleanFileRel("a/../../b"); err == nil {
		t.Fatal("expected cleaned escape")
	}
	got, err := cleanFileRel("src/App.vue")
	if err != nil || got != "src/App.vue" {
		t.Fatalf("got %q %v", got, err)
	}
}

func TestRelHardData(t *testing.T) {
	for _, rel := range []string{"pkg/data/x.txt", "a.db", ".env", ".env.local"} {
		if !relHardData(rel) {
			t.Fatalf("expected hard: %s", rel)
		}
	}
	if relHardData("src/App.vue") {
		t.Fatal("vue is not hard")
	}
}

func TestRejectStageRoot(t *testing.T) {
	if err := rejectStageRoot("/"); err == nil {
		t.Fatal("slash")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	if err := rejectStageRoot(home); err == nil {
		t.Fatal("home")
	}
	if err := rejectStageRoot(t.TempDir()); err != nil {
		t.Fatal(err)
	}
}

func TestNotebookWriteFile(t *testing.T) {
	dir := t.TempDir()
	nb := notebook.NewService(nil, dir)
	d := &Deps{Notebook: nb}
	res := toolWriteFile(context.Background(), d, []byte(`{"root":"notebook","rel_path":"运维/demo/view/src/App.vue","content":"<template>hi</template>"}`))
	if !res.OK || res.NeedsConfirm {
		t.Fatalf("%+v", res)
	}
	if !strings.Contains(string(res.Data), "Successfully wrote") {
		t.Fatalf("receipt %s", res.Data)
	}
	body, err := os.ReadFile(filepath.Join(nb.WorkspacePath(), "运维/demo/view/src/App.vue"))
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "<template>hi</template>" {
		t.Fatalf("body %s", body)
	}
	got := toolReadFile(context.Background(), d, []byte(`{"root":"notebook","rel_path":"运维/demo/view/src/App.vue"}`))
	if !got.OK || !strings.Contains(string(got.Data), "hi") {
		t.Fatalf("read %s %s", got.Error, got.Data)
	}
}

func TestDeleteNeedsConfirm(t *testing.T) {
	dir := t.TempDir()
	nb := notebook.NewService(nil, dir)
	d := &Deps{Notebook: nb}
	_ = toolWriteFile(context.Background(), d, []byte(`{"root":"notebook","rel_path":"a.txt","content":"x"}`))
	res := toolDeletePath(context.Background(), d, []byte(`{"root":"notebook","rel_path":"a.txt"}`))
	if !res.NeedsConfirm || !previewHardRisk(res.Data) {
		t.Fatalf("%+v", res)
	}
	if _, err := os.Stat(filepath.Join(nb.WorkspacePath(), "a.txt")); err != nil {
		t.Fatal("deleted before confirm")
	}
}

func TestFileToolsDefaultOn(t *testing.T) {
	if agentcap.DomainOf("write_file") != agentcap.DomainFiles {
		t.Fatal(agentcap.DomainOf("write_file"))
	}
	if !agentcap.DefaultPermissions()["write_file"] || !agentcap.DefaultPermissions()["delete_path"] {
		t.Fatal("file tools should default on")
	}
}

func TestEmptyRootSkillPathUsesHarness(t *testing.T) {
	var in fileArgs
	in.RelPath = "system/skills/host-probe-script/scripts/probe.sh"
	if strings.TrimSpace(in.Root) == "" && !pathsAreHarnessSkills(fileTouchedRels("read_file", in)) {
		t.Fatal("expected harness skill path")
	}
}

func TestHardDataWriteNeedsConfirm(t *testing.T) {
	dir := t.TempDir()
	nb := notebook.NewService(nil, dir)
	d := &Deps{Notebook: nb}
	res := toolWriteFile(context.Background(), d, []byte(`{"root":"notebook","rel_path":".env","content":"A=1"}`))
	if !res.NeedsConfirm {
		t.Fatalf("%+v", res)
	}
}
