#!/usr/bin/env python3
"""Byte-parity guard: QUICK mode must preserve review-change v1 behavior."""
import os
import sys


def main():
    pkg = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    skill = open(os.path.join(pkg, "SKILL.md"), encoding="utf-8").read()
    fixture = open(os.path.join(pkg, "fixtures", "review-change-v1.txt"),
                   encoding="utf-8").read()
    start = skill.index("<!-- QUICK-MODE-BEGIN -->") + len("<!-- QUICK-MODE-BEGIN -->")
    end = skill.index("<!-- QUICK-MODE-END -->")
    embedded = skill[start:end].strip()
    ok = embedded == fixture.strip()
    print({"quick_mode_byte_parity": ok})
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
