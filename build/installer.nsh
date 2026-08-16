; NSIS 自定义片段：默认安装到 D 盘 + 卸载时停止被托管的 dsh 服务
; 由 electron-builder.yml 的 nsis.include 引入

; 安装向导初始化时改写默认安装目录（customInit 在 initMultiUser 设置默认路径之后执行，
; preInit 会在默认值之前执行而被覆盖）
!macro customInit
  StrCpy $INSTDIR "D:\DeepSeek Harness Desktop"
!macroend

; 卸载前杀掉 3080 端口的 dsh 服务进程（防残留内存驻留与文件占用）
!macro customUnInstall
  ; 用 netstat 找 3080 的 LISTENING PID 并 taskkill
  nsExec::ExecToStack 'cmd /c "for /f "tokens=5" %a in ('"'"'netstat -ano ^| findstr :3080 ^| findstr LISTENING'"'"') do taskkill /F /PID %a"'
  Pop $0 ; 丢弃返回码（杀不到也不阻塞卸载）
!macroend

; 注意：完成页不再自定义（使用说明改为应用内引导页，首次启动自动显示）；
; 使用说明.txt 仍随安装包装入应用目录，供离线查阅。
