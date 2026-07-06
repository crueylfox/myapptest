package keyvault

const (
	LocalProtectorBlobPrefix       = "serverpilot-keyvault-v1:"
	WindowsProtectedCredentialHint = "此备份包含旧版 Windows 受保护私钥/凭据，macOS 无法直接解密；请用新版 Windows 完整备份重新导出，或在 macOS 重新导入私钥/输入密码。"
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
