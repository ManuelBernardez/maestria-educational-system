#!/usr/bin/env python3
"""Dependency-light contract tests for MaestrIA's AI provider adapter.

Runs without Django or API credentials:
    python scripts/test_ai_adapter.py

All HTTP interactions use httpx.MockTransport. No external request is sent.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import httpx

ROOT = Path(__file__).resolve().parents[1]
AI_PATH = ROOT / "backend" / "apps" / "core" / "ai.py"
SPEC = importlib.util.spec_from_file_location("maestria_ai_adapter_under_test", AI_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("No se pudo cargar el adaptador de IA.")
ai = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ai
SPEC.loader.exec_module(ai)

FAKE_KEY = "unit-test-key-not-a-real-credential"
SAMPLE_ANSWER = "La luz aporta energía y el agua participa en el proceso."


def _gemini_payload(system: str) -> dict:
    if "Sos un asistente pedagógico que ayuda" in system:
        return {
            "summary": "Reconoce la función energética de la luz.",
            "criteria": [{
                "criterion": "Comprensión conceptual", "score": 4, "max_score": 5,
                "level": "", "justification": "Explica el aporte energético.",
                "evidence": "La luz aporta energía",
            }],
            "feedback": "Buen comienzo.",
            "strengths": ["Identifica el aporte de la luz."],
            "improvement_suggestions": ["Ampliar la función del agua."],
            "warnings": [],
        }
    if "Generá preguntas claras" in system:
        return {"questions": [{
            "prompt": "¿Qué función cumple la luz?", "max_score": 5,
            "rationale": "Evalúa comprensión conceptual.",
        }]}
    if "Sos especialista en evaluación educativa" in system:
        return {
            "rubric_title": "Rúbrica de fotosíntesis", "description": "Criterios observables.",
            "criteria": [
                {"name": "Comprensión", "description": "Comprende el proceso.", "max_score": 5, "weight": 1},
                {"name": "Precisión", "description": "Usa conceptos precisos.", "max_score": 5, "weight": 1},
            ],
        }
    raise AssertionError("Se envió una instrucción de sistema no reconocida.")


class GeminiProviderTests(unittest.TestCase):
    def test_three_flows_use_current_gemini_json_request_shape(self):
        calls: list[dict] = []

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content)
            calls.append(payload)
            self.assertEqual(request.url.host, "generativelanguage.googleapis.com")
            self.assertEqual(request.headers.get("x-goog-api-key"), FAKE_KEY)
            self.assertEqual(payload["generationConfig"]["responseMimeType"], "application/json")
            self.assertIn("maxOutputTokens", payload["generationConfig"])
            self.assertIn("temperature", payload["generationConfig"])
            system = payload["systemInstruction"]["parts"][0]["text"]
            result = _gemini_payload(system)
            return httpx.Response(200, json={
                "candidates": [{
                    "content": {"parts": [{"text": json.dumps(result, ensure_ascii=False)}]},
                    "finishReason": "STOP",
                }],
            })

        env = {
            "GEMINI_API_KEY": FAKE_KEY,
            "GEMINI_THINKING_LEVEL": "minimal",
        }
        config = {"provider": "gemini", "model_name": "gemini-3.5-flash-lite", "timeout_seconds": 60}

        async def exercise():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                correction = await ai.generate_correction(
                    question="¿Qué función cumple la luz?", answer=SAMPLE_ANSWER,
                    rubric=[{"name": "Comprensión conceptual", "max_score": 5, "weight": 1}],
                    max_score=5, provider_config=config, http_client=client,
                )
                questions = await ai.generate_questions(
                    title="Fotosíntesis", subject="Ciencias", level="Secundaria",
                    objectives="Comprender el proceso.", instructions="Explicar la función de la luz.",
                    count=1, provider_config=config, http_client=client,
                )
                rubric = await ai.generate_rubric(
                    title="Fotosíntesis", subject="Ciencias", level="Secundaria",
                    objectives="Comprender el proceso.", count=2,
                    provider_config=config, http_client=client,
                )
            return correction, questions, rubric

        with patch.dict(os.environ, env, clear=False):
            correction, questions, rubric = asyncio.run(exercise())

        self.assertEqual(len(calls), 3)
        self.assertEqual(correction["suggested_total"], 4)
        self.assertEqual(correction["criteria"][0]["evidence"], "La luz aporta energía")
        self.assertFalse(correction["demo"])
        self.assertEqual(len(questions["questions"]), 1)
        self.assertFalse(questions["demo"])
        self.assertEqual(len(rubric["criteria"]), 2)
        self.assertFalse(rubric["demo"])


class OtherProviderTests(unittest.TestCase):
    def test_openai_and_ollama_support_all_three_ai_flows(self):
        fake_key = FAKE_KEY
        config_values = {
            "question": "¿Qué función cumple la luz?", "answer": SAMPLE_ANSWER,
            "rubric": [{"name": "Comprensión conceptual", "max_score": 5}], "max_score": 5,
        }

        def build_handler(provider: str):
            calls = []

            def handler(request: httpx.Request) -> httpx.Response:
                if provider == "openai":
                    self.assertEqual(request.url.host, "api.openai.com")
                    self.assertEqual(request.headers.get("authorization"), f"Bearer {fake_key}")
                    request_payload = json.loads(request.content)
                    self.assertEqual(request_payload["model"], "gpt-6-luna")
                    self.assertEqual(request_payload["reasoning_effort"], "none")
                    self.assertIn("max_completion_tokens", request_payload)
                    self.assertNotIn("max_tokens", request_payload)
                    system = request_payload["messages"][0]["content"]
                else:
                    self.assertEqual(request.url.host, "ollama.test")
                    system = json.loads(request.content)["messages"][0]["content"]
                calls.append(system)
                output = json.dumps(_gemini_payload(system), ensure_ascii=False)
                if provider == "openai":
                    return httpx.Response(200, json={"choices": [{"message": {"content": output}}]})
                return httpx.Response(200, json={"message": {"content": output}})

            return handler, calls

        async def exercise(provider: str, client: httpx.AsyncClient):
            config = {"provider": provider, "model_name": "gpt-6-luna" if provider == "openai" else "test-model", "timeout_seconds": 30}
            correction = await ai.generate_correction(
                **config_values, provider_config=config, http_client=client,
            )
            questions = await ai.generate_questions(
                title="Fotosíntesis", subject="Ciencias", level="Secundaria",
                objectives="Comprender el proceso.", instructions="Explicar la función de la luz.",
                count=1, provider_config=config, http_client=client,
            )
            rubric = await ai.generate_rubric(
                title="Fotosíntesis", subject="Ciencias", level="Secundaria",
                objectives="Comprender el proceso.", count=2,
                provider_config=config, http_client=client,
            )
            return correction, questions, rubric

        env = {
            "OPENAI_API_KEY": fake_key,
            "OLLAMA_BASE_URL": "https://ollama.test",
        }
        with patch.dict(os.environ, env, clear=False):
            results = {}
            calls_by_provider = {}
            for provider in ("openai", "ollama"):
                handler, calls = build_handler(provider)
                async def run_client():
                    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                        return await exercise(provider, client)
                results[provider] = asyncio.run(run_client())
                calls_by_provider[provider] = calls

        for provider, (correction, questions, rubric) in results.items():
            self.assertEqual(len(calls_by_provider[provider]), 3)
            self.assertFalse(correction["demo"])
            self.assertEqual(correction["suggested_total"], 4)
            self.assertFalse(questions["demo"])
            self.assertEqual(len(questions["questions"]), 1)
            self.assertFalse(rubric["demo"])
            self.assertEqual(len(rubric["criteria"]), 2)


class ConfigurationAndErrorsTests(unittest.TestCase):
    def test_database_provider_settings_override_env_and_allow_85_second_cap(self):
        with patch.dict(os.environ, {"AI_PROVIDER": "mock", "AI_TIMEOUT_SECONDS": "60"}, clear=False):
            self.assertEqual(
                ai._provider_settings({"provider": "gemini", "model_name": "gemini-3.5-flash-lite", "timeout_seconds": 85}),
                ("gemini", "gemini-3.5-flash-lite", 85),
            )

    def test_timeout_and_quota_errors_have_distinct_http_codes(self):
        timeout = httpx.ReadTimeout("timeout")
        self.assertEqual(ai.ai_error_code(timeout), "PROVIDER_TIMEOUT")
        self.assertEqual(ai.ai_error_code(timeout), "PROVIDER_TIMEOUT")
        response = httpx.Response(429, request=httpx.Request("POST", "https://provider.test"))
        quota = httpx.HTTPStatusError("quota", request=response.request, response=response)
        self.assertEqual(ai.ai_error_code(quota), "HTTP_429")

    def test_google_key_patterns_are_redacted_from_provider_errors(self):
        secret_like = "AQ." + ("A1b2C3d4E5f6G7h8I9j0" * 2)
        request = httpx.Request("POST", "https://provider.test")
        response = httpx.Response(400, request=request, json={"error": {"message": f"Invalid key {secret_like}"}})
        exc = httpx.HTTPStatusError("bad request", request=request, response=response)
        message, _ = ai.provider_error_info(exc)
        self.assertIn("[clave]", message)
        self.assertNotIn(secret_like, message)


if __name__ == "__main__":
    unittest.main(verbosity=2)
