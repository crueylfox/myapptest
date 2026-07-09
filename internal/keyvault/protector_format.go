package keyvault

const (
	LocalProtectorBlobPrefix       = "hostdeck-keyvault-v1:"
	WindowsProtectedCredentialHint = "此备份包含旧版 Windows 受保护私钥/凭据，macOS 无法直接解密；请用新版 Windows 完整备份重新导出，或在 macOS 重新导入私钥/输入密码。"
)

var legacyLocalProtectorBlobPrefix = "server" + "pilot-keyvault-v1:"

func IsLocalProtectorBlob(value []byte) bool {
	_, ok := localProtectorBlobBody(value)
	return ok
}

func localProtectorBlobBody(value []byte) ([]byte, bool) {
	if hasLocalProtectorPrefix(value, LocalProtectorBlobPrefix) {
		return value[len(LocalProtectorBlobPrefix):], true
	}
	if hasLocalProtectorPrefix(value, legacyLocalProtectorBlobPrefix) {
		return value[len(legacyLocalProtectorBlobPrefix):], true
	}
	return nil, false
}

func hasLocalProtectorPrefix(value []byte, prefix string) bool {
	if len(value) < len(prefix) {
		return false
	}
	for index := range prefix {
		if value[index] != prefix[index] {
			return false
		}
	}
	return true
}
