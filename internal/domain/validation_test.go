package domain

import "testing"

func TestNormalizeServerDisplayNameGeneratesEndpointForBlankName(t *testing.T) {
	tests := []struct {
		caseName  string
		inputName string
		host      string
		port      int
		want      string
	}{
		{caseName: "IPv4", host: "192.168.0.88", port: 22, want: "192.168.0.88:22"},
		{caseName: "hostname", host: "example.com", port: 2222, want: "example.com:2222"},
		{caseName: "IPv6", host: "2001:db8::1", port: 22, want: "[2001:db8::1]:22"},
		{caseName: "custom name", inputName: " custom ", host: "192.168.0.88", port: 22, want: "custom"},
	}
	for _, test := range tests {
		t.Run(test.caseName, func(t *testing.T) {
			got, err := NormalizeServerDisplayName(test.inputName, test.host, test.port)
			if err != nil {
				t.Fatal(err)
			}
			if got != test.want {
				t.Fatalf("display name=%q want %q", got, test.want)
			}
		})
	}
}

func TestNormalizeServerDisplayNameKeepsHostAndPortValidation(t *testing.T) {
	if _, err := NormalizeServerDisplayName("", "  ", 22); err == nil || err.Error() != "host is required" {
		t.Fatalf("host error=%v", err)
	}
	if _, err := NormalizeServerDisplayName("", "example.com", 0); err == nil || err.Error() != "port must be between 1 and 65535" {
		t.Fatalf("port error=%v", err)
	}
}
