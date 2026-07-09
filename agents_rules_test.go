package main

import (
	"os"
	"strings"
	"testing"
)

func TestAgentsContainsUiRegressionAndVersionBumpRules(t *testing.T) {
	raw, err := os.ReadFile("AGENTS.md")
	if err != nil {
		t.Fatal(err)
	}
	agents := string(raw)
	required := []string{
		"Frontend UI regression rules:",
		"Any change touching popovers, dropdowns, context menus, toolbars, bottom status overlays, dialogs, side panels, split panes, or responsive layout must include UI contract tests.",
		"Popovers must clamp to viewport and use internal scrolling when content is larger than available space.",
		"Buttons in compact toolbars must not wrap text unless explicitly designed.",
		"Version bump rule:",
		"Any development round that produces a new `build/bin/HostDeck.exe` must bump the application version in the same commit.",
		"Version sources must stay synchronized:",
		"`AI_BRIEF.md` must record old version, new version, EXE path, and SHA-256.",
	}
	for _, needle := range required {
		if !strings.Contains(agents, needle) {
			t.Fatalf("AGENTS.md missing required rule text: %q", needle)
		}
	}
}

func TestAgentsContainsYagniMinimalChangeRules(t *testing.T) {
	raw, err := os.ReadFile("AGENTS.md")
	if err != nil {
		t.Fatal(err)
	}
	agents := string(raw)
	required := []string{
		"YAGNI / minimal-change rule:",
		"If a correct one-line or small local change fully satisfies the requirement, prefer that over adding new abstractions.",
		"Do not introduce composables, helpers, services, interfaces, event buses, registries, or generalized frameworks unless the current code has real repetition, a real boundary problem, or an imminent tested use case.",
		"Prefer the smallest behavior-preserving change that passes tests and respects project boundaries.",
		"Do not use YAGNI as an excuse to skip tests, ignore user requirements, hide failures, or leave known regressions.",
	}
	for _, needle := range required {
		if !strings.Contains(agents, needle) {
			t.Fatalf("AGENTS.md missing required YAGNI rule text: %q", needle)
		}
	}
}
