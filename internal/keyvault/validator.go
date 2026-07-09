package keyvault

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/ssh"

	"hostdeck/internal/domain"
)

const (
	MaxPrivateKeyBytes   = 2 * 1024 * 1024
	CodeMissingPath      = "missing_path"
	CodeFileUnavailable  = "file_unavailable"
	CodeFileTooLarge     = "file_too_large"
	CodePassphraseNeeded = "passphrase_required"
	CodePassphraseWrong  = "passphrase_invalid"
	CodeInvalidFormat    = "invalid_format"
)

type ImportResult struct {
	Validation     domain.PrivateKeyValidationResult
	ProtectedBlob  []byte
	SourceFileName string
}

func ValidatePrivateKeyFile(request domain.ValidatePrivateKeyFileRequest) domain.PrivateKeyValidationResult {
	path := strings.TrimSpace(request.PrivateKeyPath)
	if path == "" {
		return failure(CodeMissingPath, "请选择私钥文件。", "empty private key path", false)
	}
	keyBytes, err := readPrivateKeyFile(path)
	if err != nil {
		return validationReadFailure(err)
	}
	defer wipe(keyBytes)
	return ValidatePrivateKeyBytes(keyBytes, request.Passphrase)
}

func ImportPrivateKeyFromFile(
	request domain.SaveKeyVaultEntryRequest,
	protector KeyMaterialProtector,
) (ImportResult, error) {
	path := strings.TrimSpace(request.PrivateKeyPath)
	if path == "" {
		return ImportResult{}, errors.New("请选择私钥文件")
	}
	if protector == nil {
		return ImportResult{}, errors.New("密钥保护器不可用")
	}
	keyBytes, err := readPrivateKeyFile(path)
	if err != nil {
		result := validationReadFailure(err)
		if result.UserMessage != "" {
			return ImportResult{}, errors.New(result.UserMessage)
		}
		return ImportResult{}, err
	}
	defer wipe(keyBytes)
	validation := ValidatePrivateKeyBytes(keyBytes, request.Passphrase)
	if !validation.Valid {
		return ImportResult{}, errors.New(validation.UserMessage)
	}
	protected, err := protector.Protect(keyBytes)
	if err != nil {
		return ImportResult{}, errors.New("私钥加密保存失败")
	}
	return ImportResult{
		Validation:     validation,
		ProtectedBlob:  protected,
		SourceFileName: filepath.Base(path),
	}, nil
}

func ValidatePrivateKeyBytes(keyBytes []byte, passphrase string) domain.PrivateKeyValidationResult {
	signer, err := ssh.ParsePrivateKey(keyBytes)
	if err == nil {
		return success(signer, false)
	}
	var missing *ssh.PassphraseMissingError
	if !errors.As(err, &missing) {
		return failure(CodeInvalidFormat, "私钥格式无效或当前类型暂不支持。", "parse private key failed", false)
	}
	if passphrase == "" {
		return failure(CodePassphraseNeeded, "该私钥已加密，需要输入私钥口令后验证。", "private key requires passphrase", true)
	}
	passphraseBytes := []byte(passphrase)
	defer wipe(passphraseBytes)
	signer, err = ssh.ParsePrivateKeyWithPassphrase(keyBytes, passphraseBytes)
	if err != nil {
		return failure(CodePassphraseWrong, "私钥口令错误，无法解密私钥。", "parse encrypted private key failed", true)
	}
	return success(signer, true)
}

func success(signer ssh.Signer, encrypted bool) domain.PrivateKeyValidationResult {
	publicKey := signer.PublicKey()
	return domain.PrivateKeyValidationResult{
		Algorithm:         publicKey.Type(),
		FingerprintSHA256: ssh.FingerprintSHA256(publicKey),
		Encrypted:         encrypted,
		KeyBits:           keyBits(signer),
		Valid:             true,
	}
}

func failure(code, userMessage, technicalMessage string, encrypted bool) domain.PrivateKeyValidationResult {
	return domain.PrivateKeyValidationResult{
		Encrypted:        encrypted,
		ErrorCode:        code,
		UserMessage:      userMessage,
		TechnicalMessage: technicalMessage,
	}
}

func readPrivateKeyFile(path string) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() > MaxPrivateKeyBytes {
		return nil, errPrivateKeyTooLarge
	}
	return os.ReadFile(path)
}

var errPrivateKeyTooLarge = errors.New("private key file is too large")

func validationReadFailure(err error) domain.PrivateKeyValidationResult {
	if errors.Is(err, errPrivateKeyTooLarge) {
		return failure(CodeFileTooLarge, "私钥文件过大，请选择 2 MiB 以内的 SSH 私钥。", "private key file is too large", false)
	}
	return failure(CodeFileUnavailable, "私钥文件不存在或不可读取。", "read private key failed", false)
}

func keyBits(signer ssh.Signer) int {
	cryptoKey, ok := signer.PublicKey().(ssh.CryptoPublicKey)
	if !ok {
		return 0
	}
	switch key := cryptoKey.CryptoPublicKey().(type) {
	case *rsa.PublicKey:
		if key.N == nil {
			return 0
		}
		return key.N.BitLen()
	case *ecdsa.PublicKey:
		if key.Curve == nil || key.Curve.Params() == nil {
			return 0
		}
		return key.Curve.Params().BitSize
	case ed25519.PublicKey:
		return len(key) * 8
	default:
		return 0
	}
}
