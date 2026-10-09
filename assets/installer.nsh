; 升级及静默卸载始终保留作品；交互卸载可明确选择清理当前用户数据。
!macro customUnInstall
  ${IfNot} ${isUpdated}
  ${AndIfNot} ${Silent}
    MessageBox MB_YESNOCANCEL|MB_ICONQUESTION|MB_DEFBUTTON2 "默认会保留全部作品。是否同时删除当前用户的本机 RainSoul 数据？$\r$\n$\r$\n会删除全部作品、知识、伏笔、大纲、版本快照、头像、设置和云端凭据。已导出的手稿和备份包不受影响。$\r$\n$\r$\n“否”：保留数据并继续卸载。$\r$\n“取消”：中止卸载，先在程序中备份全部需要保留的作品。" IDYES rainsoul_confirm_delete IDNO rainsoul_keep_data
    Goto rainsoul_cancel_uninstall
    rainsoul_confirm_delete:
      MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "请再次确认：已完成需要的备份，并永久删除当前用户全部本机 RainSoul 数据？$\r$\n$\r$\n默认选择“否”只卸载程序并保留数据。" IDYES rainsoul_delete_data IDNO rainsoul_keep_data
    rainsoul_delete_data:
      Var /GLOBAL rainsoulCleanupCode
      ClearErrors
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --rainsoul-uninstall-cleanup --confirm-delete-local-data' $rainsoulCleanupCode
      ${If} ${Errors}
        MessageBox MB_OK|MB_ICONSTOP "无法启动安全数据清理，程序及数据已保留。卸载已中止，请检查安装文件后重试。"
        Abort
      ${EndIf}
      ${If} $rainsoulCleanupCode != 0
        MessageBox MB_OK|MB_ICONSTOP "安全数据清理未完成，卸载已中止并保留程序。请查看 RainSoul 的错误说明；若目录被占用，请先退出程序。若出现隔离目录，剩余文件可能不完整，请按提示核对。"
        Abort
      ${EndIf}
      Goto rainsoul_keep_data
    rainsoul_cancel_uninstall:
      Abort
    rainsoul_keep_data:
  ${EndIf}
!macroend
