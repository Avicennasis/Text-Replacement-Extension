import time
import os
from playwright.sync_api import sync_playwright

def run_benchmark():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Path to the HTML file (manage.html lives in the src/ directory)
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        url = f"file://{project_root}/src/manage.html"

        # Read the mock script (use absolute path so this works regardless of CWD)
        mock_path = os.path.join(script_dir, 'mock_chrome.js')
        with open(mock_path, 'r') as f:
            mock_script = f.read()

        # Inject mock script before other scripts
        page.add_init_script(mock_script)

        # Warm up
        print("Warming up...")
        page.goto(url)
        page.wait_for_selector('tr:nth-child(255)')

        # Benchmark
        iterations = 10
        times = []

        print(f"Running {iterations} iterations...")
        for i in range(iterations):
            start_time = time.perf_counter()
            page.reload()
            page.wait_for_selector('tr:nth-child(255)') # Wait for the last row
            end_time = time.perf_counter()
            duration = (end_time - start_time) * 1000 # ms
            times.append(duration)
            print(f"Iteration {i+1}: {duration:.2f}ms")

        avg_time = sum(times) / len(times)
        print(f"\nAverage time: {avg_time:.2f}ms")

        browser.close()
        return avg_time

if __name__ == "__main__":
    run_benchmark()
