package keyvault

type KeyMaterialProtector interface {
	Protect(plaintext []byte) ([]byte, error)
	Unprotect(ciphertext []byte) ([]byte, error)
}

func wipe(value []byte) {
	for index := range value {
		value[index] = 0
	}
}
