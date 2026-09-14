# Shared model configuration for all agents.
#
# Uses GLM via OpenRouter through ADK's LiteLLM integration.
# Set OPENROUTER_API_KEY in your environment (or agents/.env).
import os

# ADK routes non-Gemini models through LiteLLM. OpenRouter models use the
# `openrouter/` prefix. Adjust the model name via env if desired.
MODEL = os.getenv("AGENT_MODEL", "openrouter/z-ai/glm-4.5")

# LiteLLM reads OPENROUTER_API_KEY natively for openrouter/ models.
# Also set a small timeout to keep tool-calling loops snappy.
os.environ.setdefault("OPENROUTER_API_KEY", "")
