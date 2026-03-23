package middleware

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"

	"github.com/coignite-aps/bl-gateway/internal/service"
)

// GatewaySign adds HMAC-SHA256 signature headers to forwarded requests so
// downstream services can verify the request came through the gateway.
func GatewaySign(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if secret == "" {
				next.ServeHTTP(w, r)
				return
			}

			acct, _ := r.Context().Value(AccountContextKey).(*service.AccountData)
			if acct == nil {
				next.ServeHTTP(w, r)
				return
			}

			ts := fmt.Sprintf("%d", time.Now().UnixMilli())
			payload := fmt.Sprintf("%s|%s|%s", acct.AccountID, acct.KeyID, ts)

			mac := hmac.New(sha256.New, []byte(secret))
			mac.Write([]byte(payload))
			sig := hex.EncodeToString(mac.Sum(nil))

			r.Header.Set("X-Gateway-Timestamp", ts)
			r.Header.Set("X-Gateway-Signature", sig)

			next.ServeHTTP(w, r)
		})
	}
}
