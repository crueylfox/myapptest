package sshclient

import (
	"fmt"

	pkgsftp "github.com/pkg/sftp"
)

func (c *Client) OpenSFTP() (*pkgsftp.Client, error) {
	client, err := pkgsftp.NewClient(c.client)
	if err != nil {
		return nil, fmt.Errorf("create SFTP client: %w", err)
	}
	return client, nil
}
