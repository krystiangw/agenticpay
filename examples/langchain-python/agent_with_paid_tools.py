"""
LangChain (Python) example: a LangChain agent that pays for tool calls via agentpay.

Same idea as the JS version: wrap an x402-paywalled HTTP endpoint as a
LangChain Tool. The Python ecosystem has no native @x402 client yet, so
we hand-roll a tiny payment helper using x402 v1 over solana-devnet
(switch to v2 + ExactSvmScheme client when Python bindings exist).

For new Python projects we recommend: use the Node.js demo as the
"agent harness" or shell out to the npx CLI. This file is illustrative
of the integration shape — it's not run from CI.

Install:
    pip install langchain langchain-anthropic solana solders requests
"""
import json
import os
from typing import Any

import requests
from langchain_anthropic import ChatAnthropic
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain.tools import StructuredTool
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

SERVER_URL = "http://localhost:4021"


class ReverseInput(BaseModel):
    text: str = Field(..., description="The string to reverse")


def reverse_string(text: str) -> str:
    """Pay 0.001 USDC and reverse a string via the agentpay MCP server.

    Real implementation needs to handle the 402 → sign → retry flow. The
    cleanest path today is to keep the agent in Node.js + @x402/fetch.
    For pure Python, see github.com/krystiangw/agentpay/issues — track
    progress on the @x402-py port.
    """
    res = requests.post(
        f"{SERVER_URL}/tools/reverse",
        json={"text": text},
        # Production: add `X-PAYMENT` header built from a signed Solana tx.
        # Use https://github.com/coinbase/x402/tree/main/python (when available)
        # or invoke the Node CLI from Python as a subprocess.
        headers={"Content-Type": "application/json"},
    )
    if res.status_code == 402:
        raise RuntimeError(
            "Payment required. Use @x402/fetch in Node, or call the agentpay CLI from a subprocess. "
            "See: https://github.com/krystiangw/agentpay#use-with-claude-code"
        )
    res.raise_for_status()
    return res.json()["result"]


tools = [
    StructuredTool.from_function(
        func=reverse_string,
        name="reverse_string",
        description="Reverse a string. Costs $0.001 USDC via x402 on Solana devnet.",
        args_schema=ReverseInput,
    ),
]

llm = ChatAnthropic(model="claude-opus-4-7", temperature=0)
prompt = ChatPromptTemplate.from_messages(
    [
        ("system", "You are a helpful assistant with paid tools."),
        ("human", "{input}"),
        ("placeholder", "{agent_scratchpad}"),
    ]
)
agent = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools)

if __name__ == "__main__":
    result = executor.invoke({"input": "Reverse the string 'agentpay rocks'."})
    print(result["output"])
