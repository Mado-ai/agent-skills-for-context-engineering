.PHONY: test serve init-owner clean lint

PYTHON ?= python3

test:                     ## Run the full suite (offline, no dependencies)
	cd tests && $(PYTHON) -m unittest discover -s . -p "test_*.py" -v

serve:                    ## Run the API and dashboard on http://127.0.0.1:8420
	$(PYTHON) -m workforce_os.server.app

lint:                     ## Byte-compile everything as a syntax check
	$(PYTHON) -m compileall -q workforce_os tests

clean:
	rm -f workforce_os.db workforce_os.db-wal workforce_os.db-shm
	find . -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true
