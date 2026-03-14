# lib/install.sh — Platform-specific Docker and dependency installation

cmd_install() {
    enable_debug_mode

    phase "Machine Setup"
    step "Inspecting platform"
    detect_os

    info "OS: $OS | Distro: ${DISTRO:-n/a} | Arch: $ARCH"

    if [ "$OS" = "linux" ]; then
        require_install_privileges || exit 1
    fi

    step "Installing Docker and dependencies"
    case "$OS" in
        linux)
            case "$DISTRO" in
                debian) install_debian ;;
                arch)   install_arch ;;
            esac
            ;;
        macos)
            install_macos
            ;;
    esac

    enable_sudo_docker_if_needed || true

    # Verify installation
    step "Verifying installation"
    if check_docker && check_compose; then
        ok "Docker $(docker --version | sed 's/[^0-9]*\([0-9][0-9.]*\).*/\1/')"
        ok "Docker Compose $(docker compose version --short 2>/dev/null)"
        for cmd in curl jq openssl; do
            command -v "$cmd" &>/dev/null && ok "$cmd"
        done
        echo ""
        info "Installation complete. You can now run: ${BOLD}./deploy/deploy-public.sh up${RESET}"
    else
        error "Installation verification failed. Please check the errors above."
        exit 1
    fi
}

install_debian() {
    info "Installing for Debian/Ubuntu..."

    # Dependencies
    run_quiet "Updating apt package index" run_privileged apt-get update -qq
    run_quiet "Installing required Debian packages" run_privileged apt-get install -y -qq ca-certificates curl gnupg jq openssl lsb-release

    if ! docker_cli_exists || ! check_compose; then
        info "Installing Docker and Docker Compose..."
        # Add Docker GPG key
        run_quiet "Preparing Docker apt keyring" run_privileged install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg \
            | run_privileged gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
        run_privileged chmod a+r /etc/apt/keyrings/docker.gpg

        # Add Docker repo
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
            https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") \
            $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
            | run_privileged tee /etc/apt/sources.list.d/docker.list > /dev/null

        run_quiet "Refreshing apt sources" run_privileged apt-get update -qq
        run_quiet "Installing Docker engine and Compose plugin" run_privileged apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
    else
        ok "Docker CLI and Compose plugin already installed"
    fi

    if command -v systemctl &>/dev/null; then
        if ! run_privileged systemctl is-active --quiet docker; then
            info "Starting Docker daemon..."
            run_quiet "Starting Docker daemon" run_privileged systemctl enable --now docker
        fi
    fi

    local target_user="${SUDO_USER:-$USER}"
    if [ -n "$target_user" ] && [ "$target_user" != "root" ] && ! id -nG "$target_user" | grep -qw docker; then
        run_privileged usermod -aG docker "$target_user"
        warn "Added $target_user to docker group. A new shell may be needed for passwordless Docker access."
    fi
}

install_arch() {
    info "Installing for Arch Linux..."

    run_quiet "Installing Arch packages" run_privileged pacman -Sy --needed --noconfirm docker docker-compose curl jq openssl

    if ! run_privileged systemctl is-active --quiet docker; then
        run_quiet "Starting Docker daemon" run_privileged systemctl enable --now docker
    fi

    local target_user="${SUDO_USER:-$USER}"
    if [ -n "$target_user" ] && [ "$target_user" != "root" ] && ! id -nG "$target_user" | grep -qw docker; then
        run_privileged usermod -aG docker "$target_user"
        warn "Added $target_user to docker group. A new shell may be needed for passwordless Docker access."
    fi
}

install_macos() {
    info "Installing for macOS..."
    info "macOS package installation is handled by Homebrew and Docker Desktop."
    info "You may see Homebrew or macOS permission prompts during the first run."

    if ! command -v brew &>/dev/null; then
        error "Homebrew not found. Install it first: https://brew.sh"
        exit 1
    fi

    # Install deps
    for pkg in jq openssl curl; do
        if ! command -v "$pkg" &>/dev/null; then
            run_quiet "Installing Homebrew package: $pkg" env HOMEBREW_NO_AUTO_UPDATE=1 brew install --quiet "$pkg"
        fi
    done

    if ! docker_cli_exists; then
        info "Installing Docker Desktop..."
        run_quiet "Installing Docker Desktop" env HOMEBREW_NO_AUTO_UPDATE=1 brew install --cask --quiet docker
    else
        ok "Docker CLI already installed"
    fi

    if ! check_docker; then
        info "Opening Docker Desktop..."
        open -a Docker >/dev/null 2>&1 || true
        if wait_for_docker_daemon 120; then
            ok "Docker Desktop is running"
        else
            echo ""
            warn "Docker Desktop is installed but not running yet. Please:"
            warn "  1. Open Docker Desktop from Applications"
            warn "  2. Complete the setup wizard"
            warn "  3. Wait for Docker to start (whale icon in menu bar)"
            if [ "$AUTO_INSTALL_FROM_UP" = "true" ]; then
                exit 1
            fi
            warn "  4. Then run: ./deploy/deploy-public.sh up"
            exit 0
        fi
    else
        ok "Docker already running"
    fi
}
