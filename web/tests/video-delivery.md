# Video delivery regression

Run the local Vite app and `python3 web/tests/video-delivery-server.py <valid-mp4>`.
Configure a video channel with Base URL `http://127.0.0.1:3078` and a dummy key.
The fixture never submits a real generation request.

1. In the actual canvas, add a video node and enter a prompt. Set fixture mode
   to `stall` with `POST /_mode {"mode":"stall"}`, then click Generate.
2. Assert the node displays downloading and its saved `videoTask.id` survives
   an IndexedDB read. Wait for the real 120-second download timeout. The node
   must show a retrieval error and a Retrieve video again button.
3. Set mode to `complete`, click that button, and verify a saved video with
   the source byte count and `video.readyState = 4`. `GET /_requests` must still
   contain exactly one `POST /v1/videos`.
4. Create another node under `stall`, wait for its saved task ID, set mode to
   `complete`, then reload the canvas. It must retrieve automatically. The
   create count must stay at two, with only status/content GETs added.
5. Open `/video?recoverTask=task_canvas_legacy_test`, click Retrieve original
   video, and verify success without any additional create POST.

Validated with the reported user's existing 4,761,381-byte, 1280×720 H.264/AAC
video. Actual canvas node creation, timeout, retry, and reload all passed;
the legacy task entry also passed. TypeScript and the production build passed.
The user's API key and video file are not stored in this repository.
