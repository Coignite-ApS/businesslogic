package proxy

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

type HealthChecker struct {
	backends []*Backend
	mu       sync.RWMutex
	statuses map[string]BackendStatus
	client   *http.Client
	interval time.Duration
}

type BackendStatus struct {
	Name    string `json:"name"`
	Healthy bool   `json:"healthy"`
	Latency string `json:"latency,omitempty"`
	Error   string `json:"error,omitempty"`
}

type HealthResponse struct {
	Status   string                   `json:"status"`
	Backends map[string]BackendStatus `json:"backends"`
}

func NewHealthChecker(backends []*Backend, interval time.Duration) *HealthChecker {
	return &HealthChecker{
		backends: backends,
		statuses: make(map[string]BackendStatus),
		client:   &http.Client{Timeout: 5 * time.Second},
		interval: interval,
	}
}

func (hc *HealthChecker) Start(ctx context.Context) {
	// Initial check
	hc.checkAll()

	ticker := time.NewTicker(hc.interval)
	go func() {
		for {
			select {
			case <-ctx.Done():
				ticker.Stop()
				return
			case <-ticker.C:
				hc.checkAll()
			}
		}
	}()
}

func (hc *HealthChecker) checkAll() {
	var wg sync.WaitGroup
	results := make(chan BackendStatus, len(hc.backends))

	for _, b := range hc.backends {
		wg.Add(1)
		go func(backend *Backend) {
			defer wg.Done()
			results <- hc.checkOne(backend)
		}(b)
	}

	go func() {
		wg.Wait()
		close(results)
	}()

	hc.mu.Lock()
	for s := range results {
		hc.statuses[s.Name] = s
	}
	hc.mu.Unlock()
}

func (hc *HealthChecker) checkOne(b *Backend) BackendStatus {
	start := time.Now()
	healthPath := "/health"
	if b.HealthPath != "" {
		healthPath = b.HealthPath
	}
	healthURL := b.URL.String() + healthPath

	resp, err := hc.client.Get(healthURL)
	latency := time.Since(start)

	if err != nil {
		log.Debug().Err(err).Str("backend", b.Name).Msg("health check failed")
		return BackendStatus{Name: b.Name, Healthy: false, Error: err.Error()}
	}
	defer resp.Body.Close()

	healthy := resp.StatusCode >= 200 && resp.StatusCode < 300
	return BackendStatus{
		Name:    b.Name,
		Healthy: healthy,
		Latency: latency.String(),
	}
}

func (hc *HealthChecker) Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		hc.mu.RLock()
		statuses := make(map[string]BackendStatus, len(hc.statuses))
		allHealthy := true
		for k, v := range hc.statuses {
			statuses[k] = v
			if !v.Healthy {
				allHealthy = false
			}
		}
		hc.mu.RUnlock()

		status := "healthy"
		httpStatus := http.StatusOK
		if !allHealthy {
			status = "degraded"
			httpStatus = http.StatusOK // still 200 — gateway itself is up
		}

		resp := HealthResponse{
			Status:   status,
			Backends: statuses,
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(httpStatus)
		json.NewEncoder(w).Encode(resp)
	}
}
