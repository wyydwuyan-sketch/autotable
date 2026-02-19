import { useState } from 'react'
import { Alert, Button, Card, Form, Input, Modal, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from './authStore'
import { authApi } from './api'

export function LoginPage() {
  const navigate = useNavigate()
  const login = useAuthStore((state) => state.login)
  const isLoading = useAuthStore((state) => state.isLoading)
  const [error, setError] = useState('')
  const [firstLoginOpen, setFirstLoginOpen] = useState(false)
  const [firstLoginLoading, setFirstLoginLoading] = useState(false)
  const [firstLoginForm] = Form.useForm<{ account: string; password: string; newPassword: string; confirmPassword: string }>()

  const handleSubmit = async (values: { username: string; password: string }) => {
    setError('')
    try {
      await login(values.username, values.password)
      navigate('/b/base_1/t/tbl_1/v/viw_1', { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : '登录失败'
      if (message.includes('首次登录请先修改密码')) {
        firstLoginForm.setFieldsValue({ account: values.username, password: values.password, newPassword: '', confirmPassword: '' })
        setFirstLoginOpen(true)
        return
      }
      setError(message)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg-app)', padding: 16 }}>
      <Card style={{ width: 420 }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>登录</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginTop: -6 }}>
          请输入已分配的账号和密码。
        </Typography.Paragraph>
        {error ? <Alert style={{ marginBottom: 12 }} type="error" message={error} showIcon /> : null}
        <Form layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={isLoading}>
            登录
          </Button>
        </Form>
      </Card>
      <Modal
        open={firstLoginOpen}
        title="首次登录请修改密码"
        onCancel={() => setFirstLoginOpen(false)}
        okText="确认修改"
        cancelText="取消"
        confirmLoading={firstLoginLoading}
        onOk={() => {
          void firstLoginForm.validateFields().then(async (values) => {
            setFirstLoginLoading(true)
            try {
              await authApi.firstLoginChangePassword(values.account, values.password, values.newPassword)
              setFirstLoginOpen(false)
              await login(values.account, values.newPassword)
              navigate('/b/base_1/t/tbl_1/v/viw_1', { replace: true })
            } catch (err) {
              setError(err instanceof Error ? err.message : '修改密码失败')
            } finally {
              setFirstLoginLoading(false)
            }
          })
        }}
      >
        <Form layout="vertical" form={firstLoginForm}>
          <Form.Item name="account" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="原密码" rules={[{ required: true, message: '请输入原密码' }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[{ required: true, message: '请输入新密码' }, { min: 8, message: '至少 8 位' }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error('两次输入的新密码不一致'))
                },
              }),
            ]}
          >
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
