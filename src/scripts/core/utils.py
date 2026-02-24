import time, asyncio, sys
from datetime import datetime

async def wait_for_element(page, selector, timeout=30, check_interval=0.2):
    """Optimized wait_for_element with faster check interval for better performance"""
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            element = await page.query_selector(selector)
            if element:
                return element
        except Exception:
            pass
        await asyncio.sleep(check_interval)
    return None

def log(msg: str, level: str = "INFO"):
    stamp = datetime.now().strftime("%H:%M:%S")
    icons = {"INFO":"ℹ️", "OK":"✅", "ERR":"❌", "STEP":"👉"}
    print(f"{icons.get(level,'ℹ️')} [{stamp}] {msg}", flush=True)

async def safe_query_selector_all(page, selector, timeout=100, interval=0.5):
    start = time.time()

    while True:
        try:
            elements = await page.query_selector_all(selector)
            if elements:
                return elements

        except Exception as e:
            print(f"Error querying {selector}: {e}", file=sys.stderr)

        if time.time() - start >= timeout:
            print(f"Timeout: No elements matched '{selector}' after {timeout} seconds", file=sys.stderr)
            return []

        # waiting before retry
        await asyncio.sleep(interval)

async def wait_for_table_rows(page, timeout=100):
    """Wait for table to have valid data rows"""
    start_time = asyncio.get_event_loop().time()
    
    while (asyncio.get_event_loop().time() - start_time) < timeout:
        try:
            # Method 1: Check if we can directly find valid macro cells
            macro_cells = await page.query_selector_all("#m-table tbody tr td:nth-child(1) a")
            
            for cell in macro_cells:
                cell_text = cell.text
                if cell_text and cell_text.strip().isdigit():
                    return True  # Found at least one valid macro ID
                    
            # Method 2: If no valid cells found, wait and retry
            await asyncio.sleep(0.5)
            
        except Exception as e:
            # If anything fails, just wait and retry
            await asyncio.sleep(0.5)
            continue
    
    return False