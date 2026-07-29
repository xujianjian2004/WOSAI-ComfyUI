# wosai_size_probe.py
#
# Layer 2 兜底：仅用于 image 输入直连"文件已在磁盘上"的节点（如 LoadImage）、
# 但前端 Layer 1（node.imgs[0] 本地预览图）因某些原因还没渲染出来的情况。
#
# 不依赖 ComfyUI PromptExecutor 的内部执行缓存 —— 那是私有实现，跨版本可能变，
# 也不要求上游节点"已经执行过"。直接按 ComfyUI /view 用的同一套 folder_paths
# 解析逻辑找到文件，用 PIL 读一次头信息即可，不需要解码整张图。
#
# 接入方式：在你的包 __init__.py 里加一行
#     from .wosai_size_probe import setup_routes
#     setup_routes()
# （如果你的插件目录结构不同，把 import 路径改成实际相对路径即可）

import os

from wosai_core.http_security import is_same_origin_request

def setup_routes():
    from server import PromptServer
    from aiohttp import web

    routes = PromptServer.instance.routes

    @routes.get("/wosai/probe_image_size")
    async def wosai_probe_image_size(request):
        """
        Query 参数（跟 ComfyUI /view 接口保持一致，方便前端直接复用 LoadImage 的 widget 值）：
          filename  必填，文件名（LoadImage 的 image widget 值，可能已含子路径）
          subfolder 可选
          type      可选，input / output / temp，默认 input
        返回: {"width": int, "height": int} 或 {"error": "..."}，404 表示文件不存在/不是有效图片。
        """
        if not is_same_origin_request(request):
            return web.json_response({"error": "cross-origin request rejected"}, status=403)
        try:
            import folder_paths
            from PIL import Image
        except Exception as e:
            return web.json_response({"error": f"missing dependency: {e}"}, status=500)

        filename = request.rel_url.query.get("filename", "")
        subfolder = request.rel_url.query.get("subfolder", "")
        type_ = request.rel_url.query.get("type", "input")

        if not filename:
            return web.json_response({"error": "missing filename"}, status=400)

        try:
            # folder_paths.get_annotated_filepath 认的是 "filename [type]" 这种标注格式，
            # 和 LoadImage 组件、/view 接口用的是同一套解析逻辑。
            # 如果你的 ComfyUI 版本 folder_paths 签名不同，这里按你本地实际 API 调整。
            annotated = f"{filename} [{type_}]" if "[" not in filename else filename
            if subfolder:
                annotated = f"{os.path.join(subfolder, filename)} [{type_}]"
            path = folder_paths.get_annotated_filepath(annotated)
        except Exception:
            path = None

        if not path or not os.path.isfile(path):
            return web.json_response({"error": "file not found"}, status=404)

        try:
            with Image.open(path) as im:
                w, h = im.size
            return web.json_response({"width": w, "height": h})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=404)
