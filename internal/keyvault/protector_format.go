package keyvault

const (
	LocalProtectorBlobPrefix       = "serverpilot-keyvault-v1:"
	WindowsProtectedCredentialHint = "此备份包含 Windows 受保护凭据，需要在 macOS 重新输入密码/私钥口令"
)

func IsLocalProtectorBlob(value []byte) bool {
	if len(value) < len(LocalProtectorBlobPrefix) {
		return false
	}
	for index := range LocalProtectorBlobPrefix {
		if value[index] != LocalProtectorBlobPrefix[index] {
			return false
		}
	}
	return true
}
