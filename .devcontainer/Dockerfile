FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

USER root

#
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    build-essential \
    curl \
    git \
    golang-go \
    gnupg \
    python3 \
    python3-pip \
    python3-venv \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Ensure Yarn APT repo key is present (fixes NO_PUBKEY issues for install-deps).
RUN curl -fsSL https://dl.yarnpkg.com/debian/pubkey.gpg \
    | gpg --dearmor -o /usr/share/keyrings/yarn-archive-keyring.gpg

# Install binaries / python libs used by MCP servers (test-wallet only).
# - lifi-mcp: https://github.com/lifinance/lifi-mcp
# - etherscan-mcp-server: https://github.com/huahuayu/etherscan-mcp-server
RUN GOBIN=/usr/local/bin go install github.com/lifinance/lifi-mcp@latest
RUN GOBIN=/usr/local/bin go install github.com/huahuayu/etherscan-mcp-server/cmd/etherscan-mcp-server@latest


RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://downloads.1password.com/linux/keys/1password.asc | gpg --dearmor -o /etc/apt/keyrings/1password-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/$(dpkg --print-architecture) stable main" > /etc/apt/sources.list.d/1password.list \
    && apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends 1password-cli \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

USER vscode

RUN curl -L https://foundry.paradigm.xyz | bash \
    && /home/vscode/.foundry/bin/foundryup

ENV PATH="/home/vscode/.foundry/bin:${PATH}"

