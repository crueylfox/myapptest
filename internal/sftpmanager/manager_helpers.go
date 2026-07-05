package sftpmanager

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strconv"
	"time"
)

func randomID() string {
	var data [4]byte
	if _, err := rand.Read(data[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return hex.EncodeToString(data[:])
}

func newTransferID() string {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return fmt.Sprintf("sftp-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(value)
}

func now() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
