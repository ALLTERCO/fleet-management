#!/usr/bin/env bash

check_port_available() {
    local port="$1"

    if command -v ss &>/dev/null; then
        ! ss -tlnH 2>/dev/null \
            | awk '{print $4}' \
            | grep -qE "(:|^)${port}$"
        return
    fi

    if command -v lsof &>/dev/null; then
        ! lsof -iTCP:"$port" -sTCP:LISTEN -P -n &>/dev/null 2>&1
        return
    fi

    ! (echo >/dev/tcp/127.0.0.1/"$port") 2>/dev/null
}
