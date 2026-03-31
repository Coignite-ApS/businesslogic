FROM golang:1.26-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o bl-gateway .

FROM alpine:3.20
RUN adduser -D -u 1000 appuser
COPY --from=builder /app/bl-gateway /usr/local/bin/
USER appuser
EXPOSE 8080
CMD ["bl-gateway"]
