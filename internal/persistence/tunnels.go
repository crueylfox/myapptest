package persistence

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"hostdeck/internal/domain"
)

var ErrTunnelProfileNameExists = errors.New("TUNNEL_PROFILE_NAME_EXISTS: 该服务器下已存在同名端口转发配置，请修改名称。")

func (s *Store) ListTunnelProfiles(ctx context.Context) ([]domain.TunnelProfile, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, server_id, type, bind_host, bind_port,
target_host, target_port, remote_bind_host, remote_bind_port, auto_start, created_at, updated_at
FROM tunnel_profiles ORDER BY server_id, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var profiles []domain.TunnelProfile
	for rows.Next() {
		profile, err := scanTunnelProfile(rows)
		if err != nil {
			return nil, err
		}
		profiles = append(profiles, profile)
	}
	return profiles, rows.Err()
}

func (s *Store) GetTunnelProfile(ctx context.Context, id int64) (domain.TunnelProfile, error) {
	return scanTunnelProfile(s.db.QueryRowContext(ctx, `SELECT id, name, server_id, type, bind_host, bind_port,
target_host, target_port, remote_bind_host, remote_bind_port, auto_start, created_at, updated_at
FROM tunnel_profiles WHERE id=?`, id))
}

func (s *Store) SaveTunnelProfile(
	ctx context.Context,
	request domain.SaveTunnelProfileRequest,
) (domain.TunnelProfile, error) {
	if err := validateTunnelProfileRequest(request); err != nil {
		return domain.TunnelProfile{}, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	name := strings.TrimSpace(request.Name)
	if err := s.ensureTunnelProfileNameAvailable(ctx, request.ServerID, name, request.ID); err != nil {
		return domain.TunnelProfile{}, err
	}
	if request.ID == 0 {
		result, err := s.db.ExecContext(ctx, `INSERT INTO tunnel_profiles(
name, server_id, type, bind_host, bind_port, target_host, target_port,
remote_bind_host, remote_bind_port, auto_start, created_at, updated_at
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			name, request.ServerID, request.Type, strings.TrimSpace(request.BindHost), request.BindPort,
			strings.TrimSpace(request.TargetHost), request.TargetPort,
			strings.TrimSpace(request.RemoteBindHost), request.RemoteBindPort, request.AutoStart, now, now,
		)
		if err != nil {
			return domain.TunnelProfile{}, tunnelProfileSaveError(err)
		}
		request.ID, err = result.LastInsertId()
		if err != nil {
			return domain.TunnelProfile{}, err
		}
	} else {
		result, err := s.db.ExecContext(ctx, `UPDATE tunnel_profiles SET
name=?, server_id=?, type=?, bind_host=?, bind_port=?, target_host=?, target_port=?,
remote_bind_host=?, remote_bind_port=?, auto_start=?, updated_at=?
WHERE id=?`,
			name, request.ServerID, request.Type, strings.TrimSpace(request.BindHost), request.BindPort,
			strings.TrimSpace(request.TargetHost), request.TargetPort,
			strings.TrimSpace(request.RemoteBindHost), request.RemoteBindPort, request.AutoStart, now, request.ID,
		)
		if err != nil {
			return domain.TunnelProfile{}, tunnelProfileSaveError(err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return domain.TunnelProfile{}, err
		}
		if affected == 0 {
			return domain.TunnelProfile{}, fmt.Errorf("tunnel profile %d not found", request.ID)
		}
	}
	return s.GetTunnelProfile(ctx, request.ID)
}

func (s *Store) ensureTunnelProfileNameAvailable(ctx context.Context, serverID int64, name string, excludeID int64) error {
	var existingID int64
	err := s.db.QueryRowContext(ctx, `SELECT id FROM tunnel_profiles
WHERE server_id=? AND name=? AND id<>? LIMIT 1`, serverID, name, excludeID).Scan(&existingID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return ErrTunnelProfileNameExists
}

func tunnelProfileSaveError(err error) error {
	if err == nil {
		return nil
	}
	text := strings.ToLower(err.Error())
	if strings.Contains(text, "idx_tunnel_profiles_server_name") ||
		(strings.Contains(text, "unique constraint") && strings.Contains(text, "tunnel_profiles")) {
		return ErrTunnelProfileNameExists
	}
	return err
}

func (s *Store) DeleteTunnelProfile(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM tunnel_profiles WHERE id=?", id)
	return err
}

func validateTunnelProfileRequest(request domain.SaveTunnelProfileRequest) error {
	if request.ServerID <= 0 {
		return errors.New("请选择服务器")
	}
	if strings.TrimSpace(request.Name) == "" {
		return errors.New("请输入隧道名称")
	}
	if request.Type != domain.TunnelTypeLocal &&
		request.Type != domain.TunnelTypeRemote &&
		request.Type != domain.TunnelTypeDynamic {
		return errors.New("隧道类型无效")
	}
	if request.Type == domain.TunnelTypeRemote {
		if strings.TrimSpace(request.RemoteBindHost) == "" {
			return errors.New("请输入远程监听地址")
		}
		if !validPort(request.RemoteBindPort) {
			return errors.New("远程监听端口必须在 1-65535 之间")
		}
	} else {
		if strings.TrimSpace(request.BindHost) == "" {
			return errors.New("请输入本地监听地址")
		}
		if !validPort(request.BindPort) {
			return errors.New("本地监听端口必须在 1-65535 之间")
		}
	}
	if request.Type != domain.TunnelTypeDynamic {
		if strings.TrimSpace(request.TargetHost) == "" {
			return errors.New("请输入目标地址")
		}
		if !validPort(request.TargetPort) {
			return errors.New("目标端口必须在 1-65535 之间")
		}
	}
	return nil
}

func validPort(port int) bool {
	return port >= 1 && port <= 65535
}

func scanTunnelProfile(row scanner) (domain.TunnelProfile, error) {
	var profile domain.TunnelProfile
	var autoStart bool
	err := row.Scan(
		&profile.ID, &profile.Name, &profile.ServerID, &profile.Type,
		&profile.BindHost, &profile.BindPort, &profile.TargetHost, &profile.TargetPort,
		&profile.RemoteBindHost, &profile.RemoteBindPort, &autoStart,
		&profile.CreatedAt, &profile.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.TunnelProfile{}, err
		}
		return domain.TunnelProfile{}, err
	}
	profile.AutoStart = autoStart
	return profile, nil
}
