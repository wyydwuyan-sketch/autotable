import type { ReactNode } from 'react'
import { Modal } from 'antd'

type ConfirmActionOptions = {
  title: ReactNode
  content?: ReactNode
  okText?: string
  cancelText?: string
  danger?: boolean
}

export const confirmAction = ({
  title,
  content,
  okText = '确认',
  cancelText = '取消',
  danger = false,
}: ConfirmActionOptions) =>
  new Promise<boolean>((resolve) => {
    Modal.confirm({
      title,
      content,
      okText,
      cancelText,
      okButtonProps: danger ? { danger: true } : undefined,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })

