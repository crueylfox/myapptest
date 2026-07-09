package main

import (
	"hostdeck/internal/domain"
)

func (a *App) ListLogs(limit int) ([]domain.LogEntry, error) {
	_, logger, _, err := a.dependencies()
	if err != nil {
		return nil, err
	}
	return logger.List(limit), nil
}

func (a *App) LogFrontendError(source string) error {
	_, logger, _, err := a.dependencies()
	if err != nil {
		return err
	}
	switch source {
	case "vue", "promise", "monitor-boundary":
	default:
		source = "frontend"
	}
	logger.Write("error", "前端运行时错误", "frontend."+source, 0, nil)
	return nil
}
